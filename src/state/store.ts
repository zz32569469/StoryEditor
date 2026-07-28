import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import {
  createChoice,
  createEmptyProject,
  createNode,
  createScene,
  newId,
} from '../schema';
import type {
  Branch,
  Character,
  Choice,
  ExportSnapshot,
  Scene,
  StoryNode,
  StoryProject,
  Variable,
} from '../schema/story';
import { renameIdentifier } from '../expr/parse';
import { renamePlaceholder } from '../tags/interpolate';
import { applyCells } from '../sync/apply';

/**
 * 編輯器狀態。
 *
 * 專案資料是唯一真實來源，預覽只是它的投影 —— 任何編輯都直接改 project，
 * 預覽元件從 store 讀取後即時重算，兩者之間不存在需要手動同步的中間狀態。
 */
export interface EditorState {
  project: StoryProject;
  selectedSceneId: string | null;
  selectedNodeId: string | null;
  /** 預覽與編輯面板目前顯示的語言。 */
  lang: string;

  loadProject: (project: StoryProject) => void;
  resetProject: () => void;
  setProjectName: (name: string) => void;
  /** 匯出 Excel 後寫回快照，作為下次匯入的合併基準。 */
  setExportSnapshot: (snapshot: ExportSnapshot) => void;
  /** 套用匯入報告中被接受的儲存格。 */
  applyImportedCells: (accepted: Record<string, string>) => { applied: number; skipped: number };

  selectScene: (sceneId: string) => void;
  selectNode: (nodeId: string) => void;
  setLang: (lang: string) => void;

  addScene: () => void;
  updateScene: (sceneId: string, patch: Partial<Pick<Scene, 'name' | 'entryNodeId'>>) => void;
  deleteScene: (sceneId: string) => void;

  addNode: () => void;
  updateNode: (nodeId: string, patch: Partial<StoryNode>) => void;
  setNodeText: (nodeId: string, lang: string, text: string) => void;
  moveNode: (nodeId: string, delta: number) => void;
  deleteNode: (nodeId: string) => void;

  updateBranch: (nodeId: string, branchId: string, patch: Partial<Branch>) => void;

  addChoice: (nodeId: string) => void;
  updateChoice: (nodeId: string, choiceId: string, patch: Partial<Choice>) => void;
  setChoiceText: (nodeId: string, choiceId: string, lang: string, text: string) => void;
  deleteChoice: (nodeId: string, choiceId: string) => void;

  addCharacter: () => void;
  updateCharacter: (characterId: string, patch: Partial<Character>) => void;
  deleteCharacter: (characterId: string) => void;

  addLanguage: (lang: string) => void;

  addVariable: () => void;
  updateVariable: (variableId: string, patch: Partial<Variable>) => void;
  deleteVariable: (variableId: string) => void;
}

function findScene(project: StoryProject, sceneId: string | null): Scene | undefined {
  return project.scenes.find((s) => s.id === sceneId);
}

function findNodeLocation(
  project: StoryProject,
  nodeId: string,
): { scene: Scene; index: number } | undefined {
  for (const scene of project.scenes) {
    const index = scene.nodes.findIndex((n) => n.id === nodeId);
    if (index >= 0) return { scene, index };
  }
  return undefined;
}

/**
 * 刪除節點後清掉所有指向它的參照。
 *
 * 少了這一步，專案會留下指向不存在節點的 next/targetNodeId，
 * 而參照完整性檢查會在匯出時才報錯 —— 離出錯的操作太遠，難以理解。
 */
function unlinkNode(project: StoryProject, nodeId: string): void {
  for (const scene of project.scenes) {
    if (scene.entryNodeId === nodeId) {
      scene.entryNodeId = scene.nodes.find((n) => n.id !== nodeId)?.id ?? null;
    }
    for (const node of scene.nodes) {
      if (node.next === nodeId) node.next = null;
      for (const choice of node.choices) {
        if (choice.targetNodeId === nodeId) choice.targetNodeId = null;
      }
      for (const branch of node.branches) {
        if (branch.targetNodeId === nodeId) branch.targetNodeId = null;
      }
    }
  }
}

function uniqueKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i += 1) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** 開啟編輯器時的初始專案：一個場景、一句話，讓預覽區立刻有東西可看。 */
function starterProject(): StoryProject {
  const project = createEmptyProject('未命名專案', ['zh']);
  const first = createNode({ text: { zh: '在這裡輸入第一句台詞。' } });
  project.scenes = [createScene('第一幕', [first])];
  return project;
}

export const useEditor = create<EditorState>()(
  immer((set) => ({
    project: starterProject(),
    selectedSceneId: null,
    selectedNodeId: null,
    lang: 'zh',

    loadProject: (project) =>
      set((state) => {
        state.project = project;
        state.selectedSceneId = project.scenes[0]?.id ?? null;
        state.selectedNodeId = project.scenes[0]?.nodes[0]?.id ?? null;
        state.lang = project.meta.baseLanguage;
      }),

    resetProject: () =>
      set((state) => {
        state.project = starterProject();
        state.selectedSceneId = state.project.scenes[0]!.id;
        state.selectedNodeId = state.project.scenes[0]!.nodes[0]!.id;
        state.lang = 'zh';
      }),

    setProjectName: (name) => set((state) => void (state.project.meta.projectName = name)),

    setExportSnapshot: (snapshot) => set((state) => void (state.project.exportSnapshot = snapshot)),

    applyImportedCells: (accepted) => {
      let result = { applied: 0, skipped: 0 };
      set((state) => {
        result = applyCells(state.project, accepted);
      });
      return result;
    },

    selectScene: (sceneId) =>
      set((state) => {
        state.selectedSceneId = sceneId;
        state.selectedNodeId = findScene(state.project, sceneId)?.nodes[0]?.id ?? null;
      }),

    selectNode: (nodeId) =>
      set((state) => {
        state.selectedNodeId = nodeId;
        const found = findNodeLocation(state.project, nodeId);
        if (found) state.selectedSceneId = found.scene.id;
      }),

    setLang: (lang) => set((state) => void (state.lang = lang)),

    addScene: () =>
      set((state) => {
        const node = createNode({ text: { [state.project.meta.baseLanguage]: '' } });
        const scene = createScene(`第 ${state.project.scenes.length + 1} 幕`, [node]);
        state.project.scenes.push(scene);
        state.selectedSceneId = scene.id;
        state.selectedNodeId = node.id;
      }),

    updateScene: (sceneId, patch) =>
      set((state) => {
        const scene = findScene(state.project, sceneId);
        if (scene) Object.assign(scene, patch);
      }),

    deleteScene: (sceneId) =>
      set((state) => {
        const scene = findScene(state.project, sceneId);
        if (!scene) return;
        for (const node of scene.nodes) unlinkNode(state.project, node.id);
        state.project.scenes = state.project.scenes.filter((s) => s.id !== sceneId);
        const fallback = state.project.scenes[0];
        state.selectedSceneId = fallback?.id ?? null;
        state.selectedNodeId = fallback?.nodes[0]?.id ?? null;
      }),

    addNode: () =>
      set((state) => {
        const scene = findScene(state.project, state.selectedSceneId) ?? state.project.scenes[0];
        if (!scene) return;

        const node = createNode({ text: { [state.project.meta.baseLanguage]: '' } });
        const afterIndex = scene.nodes.findIndex((n) => n.id === state.selectedNodeId);
        const insertAt = afterIndex >= 0 ? afterIndex + 1 : scene.nodes.length;
        scene.nodes.splice(insertAt, 0, node);

        // 順手把前一個節點接上來：線性劇情是最常見的情況，不該每次都手動連。
        const previous = scene.nodes[insertAt - 1];
        if (previous && previous.next === null && previous.choices.length === 0) {
          previous.next = node.id;
        }
        if (scene.entryNodeId === null) scene.entryNodeId = node.id;

        state.selectedSceneId = scene.id;
        state.selectedNodeId = node.id;
      }),

    updateNode: (nodeId, patch) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        if (found) Object.assign(found.scene.nodes[found.index]!, patch);
      }),

    setNodeText: (nodeId, lang, text) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        if (found) found.scene.nodes[found.index]!.text[lang] = text;
      }),

    moveNode: (nodeId, delta) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        if (!found) return;
        const { scene, index } = found;
        const target = index + delta;
        if (target < 0 || target >= scene.nodes.length) return;
        const [node] = scene.nodes.splice(index, 1);
        scene.nodes.splice(target, 0, node!);
      }),

    deleteNode: (nodeId) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        if (!found) return;
        const { scene, index } = found;
        unlinkNode(state.project, nodeId);
        scene.nodes.splice(index, 1);
        state.selectedNodeId = scene.nodes[Math.min(index, scene.nodes.length - 1)]?.id ?? null;
      }),

    updateBranch: (nodeId, branchId, patch) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        const branch = found?.scene.nodes[found.index]!.branches.find((b) => b.id === branchId);
        if (branch) Object.assign(branch, patch);
      }),

    addChoice: (nodeId) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        if (!found) return;
        const node = found.scene.nodes[found.index]!;
        node.choices.push(createChoice({ text: { [state.project.meta.baseLanguage]: '新選項' } }));
        // 有選項時 runtime 會忽略 next，清掉避免誤導。
        node.next = null;
      }),

    updateChoice: (nodeId, choiceId, patch) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        const choice = found?.scene.nodes[found.index]!.choices.find((c) => c.id === choiceId);
        if (choice) Object.assign(choice, patch);
      }),

    setChoiceText: (nodeId, choiceId, lang, text) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        const choice = found?.scene.nodes[found.index]!.choices.find((c) => c.id === choiceId);
        if (choice) choice.text[lang] = text;
      }),

    deleteChoice: (nodeId, choiceId) =>
      set((state) => {
        const found = findNodeLocation(state.project, nodeId);
        if (!found) return;
        const node = found.scene.nodes[found.index]!;
        node.choices = node.choices.filter((c) => c.id !== choiceId);
      }),

    addCharacter: () =>
      set((state) => {
        const taken = new Set(state.project.characters.map((c) => c.id));
        const id = uniqueKey('new_character', taken);
        state.project.characters.push({
          id,
          name: { [state.project.meta.baseLanguage]: '新角色' },
        });
      }),

    updateCharacter: (characterId, patch) =>
      set((state) => {
        const character = state.project.characters.find((c) => c.id === characterId);
        if (!character) return;
        const nextId = patch.id;
        // 角色 id 是人類可讀的 key，改名時要一併更新所有引用它的節點。
        if (nextId && nextId !== characterId) {
          for (const scene of state.project.scenes) {
            for (const node of scene.nodes) {
              if (node.speaker === characterId) node.speaker = nextId;
            }
          }
        }
        Object.assign(character, patch);
      }),

    deleteCharacter: (characterId) =>
      set((state) => {
        state.project.characters = state.project.characters.filter((c) => c.id !== characterId);
        for (const scene of state.project.scenes) {
          for (const node of scene.nodes) {
            if (node.speaker === characterId) node.speaker = undefined;
          }
        }
      }),

    addLanguage: (lang) =>
      set((state) => {
        if (!lang || state.project.meta.languages.includes(lang)) return;
        state.project.meta.languages.push(lang);
      }),

    addVariable: () =>
      set((state) => {
        const taken = new Set(state.project.variables.map((v) => v.id));
        state.project.variables.push({
          id: uniqueKey('new_flag', taken),
          type: 'bool',
          default: false,
          description: '',
        });
      }),

    updateVariable: (variableId, patch) =>
      set((state) => {
        const variable = state.project.variables.find((v) => v.id === variableId);
        if (!variable) return;

        const nextId = patch.id;
        if (nextId && nextId !== variableId) {
          // 變數名散落在三個地方：條件式、賦值／輸入運算式，以及台詞裡的 <插值>。
          // 少改任何一處，改名就等於把劇本改壞。
          for (const scene of state.project.scenes) {
            for (const node of scene.nodes) {
              for (const branch of node.branches) {
                branch.condition = renameIdentifier(branch.condition, variableId, nextId);
              }
              if (node.expression) {
                node.expression = renameIdentifier(node.expression, variableId, nextId);
              }
              for (const action of node.actions) {
                if (action.variable === variableId) action.variable = nextId;
              }
              for (const lang of Object.keys(node.text)) {
                node.text[lang] = renamePlaceholder(node.text[lang]!, variableId, nextId);
              }
              for (const choice of node.choices) {
                for (const lang of Object.keys(choice.text)) {
                  choice.text[lang] = renamePlaceholder(choice.text[lang]!, variableId, nextId);
                }
              }
            }
          }
        }
        Object.assign(variable, patch);
      }),

    deleteVariable: (variableId) =>
      set((state) => {
        state.project.variables = state.project.variables.filter((v) => v.id !== variableId);
        for (const scene of state.project.scenes) {
          for (const node of scene.nodes) {
            node.actions = node.actions.filter((a) => a.variable !== variableId);
          }
        }
      }),
  })),
);

/** 供元件取得目前選取的場景／節點，避免每個元件各自重寫查找邏輯。 */
export function useSelectedScene(): Scene | undefined {
  return useEditor((s) => findScene(s.project, s.selectedSceneId) ?? s.project.scenes[0]);
}

export function useSelectedNode(): StoryNode | undefined {
  return useEditor((s) => {
    const scene = findScene(s.project, s.selectedSceneId) ?? s.project.scenes[0];
    return scene?.nodes.find((n) => n.id === s.selectedNodeId) ?? scene?.nodes[0];
  });
}

export { newId };
