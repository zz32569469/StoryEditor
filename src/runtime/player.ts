import {
  BUILTIN_FUNCTIONS,
  evaluate,
  truthy,
  type EvalContext,
  type HostFunction,
  type Value,
} from '../expr/evaluate';
import { parseAssignment, parseExpression, parseInputTargets } from '../expr/parse';
import type { Scene, StoryNode, StoryProject } from '../schema/story';

/**
 * 劇情播放器。
 *
 * 純狀態機，不碰 UI —— 走訪規則（分支怎麼選、set 怎麼套、選項怎麼跳）
 * 是 Unity 端也要照著實作的東西，寫成可測試的純函式才不會兩邊分歧。
 *
 * 呼叫方持有 PlayerState，透過 advance / choose / submitInput 推進。
 */

export type PlayerStatus =
  /** 停在一句台詞上，等待玩家繼續。 */
  | 'line'
  /** 停在選項上，等待玩家選擇。 */
  | 'choices'
  /** 等待玩家輸入。 */
  | 'input'
  /** 劇情結束。 */
  | 'ended'
  /** 出錯而停下（未定義變數、運算式壞掉、跳轉斷掉…）。 */
  | 'error';

export interface PlayerState {
  sceneId: string;
  /** 目前停留的節點；ended 時為 null。 */
  nodeId: string | null;
  status: PlayerStatus;
  variables: Map<string, Value>;
  /** input 狀態時要填的變數名。 */
  pendingInputs: string[];
  /** error 狀態的說明。 */
  error: string | null;
  /** 走過的節點，用來偵測無限迴圈。 */
  visited: string[];
}

export interface PlayerOptions {
  /** 遊戲特有的函式，會覆蓋同名的內建函式。 */
  functions?: Record<string, HostFunction>;
  /** 變數初始值，用來模擬遊戲提供的外部狀態。 */
  initialVariables?: Record<string, Value>;
}

/** 單次推進最多可以連續處理幾個節點，超過視為迴圈。 */
const MAX_STEPS = 1000;

function contextOf(state: PlayerState, options: PlayerOptions): EvalContext {
  return {
    variables: state.variables,
    functions: { ...BUILTIN_FUNCTIONS, ...options.functions },
  };
}

function fail(state: PlayerState, message: string): PlayerState {
  return { ...state, status: 'error', error: message };
}

function nodeOf(scene: Scene, nodeId: string | null): StoryNode | undefined {
  return scene.nodes.find((n) => n.id === nodeId);
}

/**
 * 從指定節點開始往下跑，直到停在需要玩家操作的地方。
 *
 * branch / set 這類流程控制節點不需要玩家介入，會連續處理完；
 * 停下來的一定是台詞、選項、輸入、結束或錯誤。
 */
function settle(state: PlayerState, scene: Scene, options: PlayerOptions): PlayerState {
  let current = state;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (current.nodeId === null) return { ...current, status: 'ended' };

    const node = nodeOf(scene, current.nodeId);
    if (!node) return fail(current, `找不到節點 ${current.nodeId}`);

    current = { ...current, visited: [...current.visited, node.id] };

    switch (node.kind) {
      case 'end':
        return { ...current, status: 'ended', nodeId: node.id };

      case 'line': {
        if (node.choices.length > 0) return { ...current, status: 'choices' };
        return { ...current, status: 'line' };
      }

      case 'input': {
        const targets = parseInputTargets(node.expression ?? '');
        if (!targets.ok) return fail(current, `輸入節點：${targets.error.message}`);
        return { ...current, status: 'input', pendingInputs: targets.value };
      }

      case 'set': {
        const assignment = parseAssignment(node.expression ?? '');
        if (!assignment.ok) {
          return fail(current, `賦值「${node.expression}」：${assignment.error.message}`);
        }
        const result = evaluate(assignment.value.value, contextOf(current, options));
        if (!result.ok) return fail(current, `賦值「${node.expression}」：${result.message}`);

        const variables = new Map(current.variables);
        variables.set(assignment.value.target, result.value);
        current = { ...current, variables, nodeId: node.next };
        continue;
      }

      case 'branch': {
        let taken: string | null | undefined;
        for (const branch of node.branches) {
          const parsed = parseExpression(branch.condition);
          if (!parsed.ok) {
            return fail(current, `條件「${branch.condition}」：${parsed.error.message}`);
          }
          const result = evaluate(parsed.value, contextOf(current, options));
          if (!result.ok) return fail(current, `條件「${branch.condition}」：${result.message}`);
          if (truthy(result.value)) {
            taken = branch.targetNodeId;
            break;
          }
        }
        if (taken === undefined) {
          // 沒有任何條件成立。來源劇本的分支通常互補，走到這裡多半是資料問題。
          return fail(
            current,
            `分支沒有任何條件成立：${node.branches.map((b) => b.condition).join('、')}`,
          );
        }
        current = { ...current, nodeId: taken };
        continue;
      }
    }
  }

  return fail(current, `連續處理超過 ${MAX_STEPS} 個節點，可能有無限迴圈`);
}

export function startScene(
  project: StoryProject,
  sceneId: string,
  options: PlayerOptions = {},
): PlayerState {
  const scene = project.scenes.find((s) => s.id === sceneId);
  const initial: PlayerState = {
    sceneId,
    nodeId: scene?.entryNodeId ?? null,
    status: 'line',
    variables: new Map(Object.entries(options.initialVariables ?? {})),
    pendingInputs: [],
    error: null,
    visited: [],
  };

  if (!scene) return fail(initial, `找不到場景 ${sceneId}`);

  // 專案宣告的變數預設值先放進去，之後才被 initialVariables 覆蓋。
  const variables = new Map<string, Value>();
  for (const variable of project.variables) variables.set(variable.id, variable.default);
  for (const [key, value] of Object.entries(options.initialVariables ?? {})) {
    variables.set(key, value);
  }

  return settle({ ...initial, variables }, scene, options);
}

/** 從台詞往下一句。 */
export function advance(
  project: StoryProject,
  state: PlayerState,
  options: PlayerOptions = {},
): PlayerState {
  const scene = project.scenes.find((s) => s.id === state.sceneId);
  if (!scene) return fail(state, `找不到場景 ${state.sceneId}`);
  if (state.status !== 'line') return state;

  const node = nodeOf(scene, state.nodeId);
  if (!node) return fail(state, `找不到節點 ${state.nodeId}`);

  return settle({ ...state, nodeId: node.next }, scene, options);
}

export function choose(
  project: StoryProject,
  state: PlayerState,
  choiceId: string,
  options: PlayerOptions = {},
): PlayerState {
  const scene = project.scenes.find((s) => s.id === state.sceneId);
  if (!scene) return fail(state, `找不到場景 ${state.sceneId}`);
  if (state.status !== 'choices') return state;

  const node = nodeOf(scene, state.nodeId);
  const choice = node?.choices.find((c) => c.id === choiceId);
  if (!choice) return fail(state, `找不到選項 ${choiceId}`);

  return settle({ ...state, nodeId: choice.targetNodeId }, scene, options);
}

export function submitInput(
  project: StoryProject,
  state: PlayerState,
  values: Record<string, Value>,
  options: PlayerOptions = {},
): PlayerState {
  const scene = project.scenes.find((s) => s.id === state.sceneId);
  if (!scene) return fail(state, `找不到場景 ${state.sceneId}`);
  if (state.status !== 'input') return state;

  const node = nodeOf(scene, state.nodeId);
  if (!node) return fail(state, `找不到節點 ${state.nodeId}`);

  const variables = new Map(state.variables);
  for (const name of state.pendingInputs) {
    // 數字外觀的輸入轉成數字，否則 age < 25 這種比較會失敗。
    const raw = values[name] ?? '';
    const asNumber = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    variables.set(name, Number.isFinite(asNumber) ? asNumber : raw);
  }

  return settle(
    { ...state, variables, pendingInputs: [], nodeId: node.next },
    scene,
    options,
  );
}

/** 目前停留的節點，供 UI 顯示。 */
export function currentNode(project: StoryProject, state: PlayerState): StoryNode | undefined {
  const scene = project.scenes.find((s) => s.id === state.sceneId);
  return scene ? nodeOf(scene, state.nodeId) : undefined;
}
