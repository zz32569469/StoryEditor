import {
  BUILTIN_FUNCTIONS,
  evaluate,
  truthy,
  type EvalContext,
  type HostFunction,
  type Value,
} from '../expr/evaluate';
import { parseAssignment, parseExpression, parseInputTargets } from '../expr/parse';
import type { Scene, Stage, StoryNode, StoryProject } from '../schema/story';
import { attributeTable } from '../stage/attributes';
import { isEmptyStage, parseStage } from '../stage/directives';

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
  /**
   * choices 狀態時玩家看得到的選項 id，依劇本順序。
   *
   * 解鎖條件在**抵達**選項時判斷一次並記在這裡：UI 只照這份顯示，
   * choose 也只收這份裡的 id —— 兩邊各算一次的話，條件裡的變數在中間變了就會對不上。
   */
  availableChoices: string[];
  /** error 狀態的說明。 */
  error: string | null;
  /** 走過的節點，用來偵測無限迴圈。 */
  visited: string[];
  /**
   * 這一步（一次 start／advance／choose／submitInput）經過、且有演出欄位的節點／選項／分支，依序。
   * 畫面層照這份清單依序執行背景、插圖、畫面效果、音效…；控制列（set／if）上的演出也在裡面。
   */
  cues: Cue[];
  /** 這一步套用的屬性變化，給遊戲接到自己的數值上。找不到變數的 variable 為 null（沒有套用）。 */
  effects: AttributeEffect[];
}

export interface Cue {
  kind: 'node' | 'choice' | 'branch';
  id: string;
}

export interface AttributeEffect {
  name: string;
  delta: number;
  variable: string | null;
  target: string | null;
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

/** 每一步開始時清空：cues／effects 只描述「這一步」發生的事。 */
function beginStep(state: PlayerState): PlayerState {
  return { ...state, cues: [], effects: [] };
}

/**
 * 進入一列（或選了選項、走了分支）時的演出：記下 cue，並套用屬性變化。
 *
 * 屬性變化在走訪當下就套用，所以同一次推進中緊接的 if 看得到新值。
 * 名稱照變數的 label（屬性清單）找，找不到就只記下 effect、不改任何變數 ——
 * 劇本檢查會把那一處列出來，播放時不該因此停下。
 */
function enter(
  state: PlayerState,
  project: StoryProject,
  kind: Cue['kind'],
  id: string,
  stage: Stage | undefined,
): PlayerState {
  if (isEmptyStage(stage)) return state;
  const parsed = parseStage(stage);
  const cues = [...state.cues, { kind, id }];
  if (parsed.attributes.length === 0) return { ...state, cues };

  const table = attributeTable(project.variables);
  const variables = new Map(state.variables);
  const effects = [...state.effects];
  for (const change of parsed.attributes) {
    const variable = table.get(change.name);
    const current = variable ? variables.get(variable.id) : undefined;
    const applied = variable?.type === 'number' && (current === undefined || typeof current === 'number');
    if (applied) variables.set(variable.id, (current ?? 0) + change.delta);
    effects.push({
      name: change.name,
      delta: change.delta,
      variable: applied ? variable.id : null,
      target: parsed.target ?? null,
    });
  }
  return { ...state, cues, effects, variables };
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
function settle(
  state: PlayerState,
  project: StoryProject,
  scene: Scene,
  options: PlayerOptions,
): PlayerState {
  let current: PlayerState = { ...state, availableChoices: [] };

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (current.nodeId === null) return { ...current, status: 'ended' };

    const node = nodeOf(scene, current.nodeId);
    if (!node) return fail(current, `找不到節點 ${current.nodeId}`);

    current = { ...current, visited: [...current.visited, node.id] };
    current = enter(current, project, 'node', node.id, node.stage);

    switch (node.kind) {
      case 'end':
        return { ...current, status: 'ended', nodeId: node.id };

      case 'line': {
        if (node.choices.length === 0) return { ...current, status: 'line' };

        const available: string[] = [];
        for (const choice of node.choices) {
          if (!choice.condition?.trim()) {
            available.push(choice.id);
            continue;
          }
          const parsed = parseExpression(choice.condition);
          if (!parsed.ok) {
            return fail(current, `選項條件「${choice.condition}」：${parsed.error.message}`);
          }
          const result = evaluate(parsed.value, contextOf(current, options));
          if (!result.ok) return fail(current, `選項條件「${choice.condition}」：${result.message}`);
          if (truthy(result.value)) available.push(choice.id);
        }
        if (available.length === 0) {
          // 停在一個沒有任何選項可按的畫面，玩家只能卡死；明確報錯才找得到是哪一組。
          return fail(
            current,
            `所有選項的條件都不成立：${node.choices.map((c) => c.condition ?? '').join('、')}`,
          );
        }
        return { ...current, status: 'choices', availableChoices: available };
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
        let takenBranch: (typeof node.branches)[number] | undefined;
        for (const branch of node.branches) {
          const parsed = parseExpression(branch.condition);
          if (!parsed.ok) {
            return fail(current, `條件「${branch.condition}」：${parsed.error.message}`);
          }
          const result = evaluate(parsed.value, contextOf(current, options));
          if (!result.ok) return fail(current, `條件「${branch.condition}」：${result.message}`);
          if (truthy(result.value)) {
            taken = branch.targetNodeId;
            takenBranch = branch;
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
        current = enter(current, project, 'branch', takenBranch!.id, takenBranch!.stage);
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
    availableChoices: [],
    error: null,
    visited: [],
    cues: [],
    effects: [],
  };

  if (!scene) return fail(initial, `找不到場景 ${sceneId}`);

  // 專案宣告的變數預設值先放進去，之後才被 initialVariables 覆蓋。
  const variables = new Map<string, Value>();
  for (const variable of project.variables) variables.set(variable.id, variable.default);
  for (const [key, value] of Object.entries(options.initialVariables ?? {})) {
    variables.set(key, value);
  }

  return settle({ ...initial, variables }, project, scene, options);
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

  return settle({ ...beginStep(state), nodeId: node.next }, project, scene, options);
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
  if (!state.availableChoices.includes(choiceId)) {
    return fail(state, `選項 ${choiceId} 的條件不成立，不能選`);
  }

  const chosen = enter(beginStep(state), project, 'choice', choice.id, choice.stage);
  return settle({ ...chosen, nodeId: choice.targetNodeId }, project, scene, options);
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
    const raw = values[name] ?? '';
    const declared = project.variables.find((v) => v.id === name)?.type;

    if (declared === 'number') {
      const asNumber = typeof raw === 'string' ? Number(raw) : Number(raw);
      variables.set(name, Number.isFinite(asNumber) ? asNumber : 0);
      continue;
    }
    // 日期與文字都保持字串 —— 日期若被轉成數字，CalcAge 會拿到無效值。
    if (declared === 'date' || declared === 'string') {
      variables.set(name, String(raw));
      continue;
    }
    if (declared === 'bool') {
      variables.set(name, raw === true || raw === 'true');
      continue;
    }

    // 沒有宣告時只好看外觀猜：數字外觀轉數字，否則 age < 25 這種比較會失敗。
    const asNumber = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    variables.set(name, Number.isFinite(asNumber) ? asNumber : raw);
  }

  return settle(
    { ...beginStep(state), variables, pendingInputs: [], nodeId: node.next },
    project,
    scene,
    options,
  );
}

/** 目前停留的節點，供 UI 顯示。 */
export function currentNode(project: StoryProject, state: PlayerState): StoryNode | undefined {
  const scene = project.scenes.find((s) => s.id === state.sceneId);
  return scene ? nodeOf(scene, state.nodeId) : undefined;
}
