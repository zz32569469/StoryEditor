import { newId } from './ids';
import { DEFAULT_TAG_REGISTRY } from './tags';
import {
  FORMAT_VERSION,
  type Choice,
  type Scene,
  type StoryNode,
  type StoryProject,
} from './story';

/**
 * 建構函式集中在這裡，避免各處手刻物件時漏欄位或自己生 id。
 * 專案內任何新實體都應該經由這些函式產生 —— 這是 id 不可變原則的執行面保證。
 */

export function createNode(init: Partial<StoryNode> & { text: StoryNode['text'] }): StoryNode {
  return {
    id: newId(),
    kind: 'line',
    choices: [],
    next: null,
    actions: [],
    notes: '',
    branches: [],
    extras: {},
    ...init,
  };
}

export function createChoice(init: Partial<Choice> & { text: Choice['text'] }): Choice {
  return { id: newId(), targetNodeId: null, extras: {}, ...init };
}

export function createScene(name: string, nodes: StoryNode[] = []): Scene {
  return { id: newId(), name, entryNodeId: nodes[0]?.id ?? null, nodes };
}

export function createEmptyProject(
  projectName = '',
  languages: [string, ...string[]] = ['zh'],
  baseLanguage: string = languages[0],
): StoryProject {
  return {
    meta: {
      formatVersion: FORMAT_VERSION,
      projectName,
      languages,
      baseLanguage,
      updatedAt: new Date().toISOString(),
      tagSyntax: 'bracket',
    },
    tagRegistry: structuredClone(DEFAULT_TAG_REGISTRY),
    variables: [],
    characters: [],
    scenes: [],
    exportSnapshot: null,
  };
}
