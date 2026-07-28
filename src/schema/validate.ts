import { collectPlaceholders } from '../tags/interpolate';
import { FORMAT_VERSION, StoryProjectSchema } from './story';
import type { StoryProject } from './story';

/**
 * 參照完整性檢查。
 *
 * 刻意「不」寫成 zod 的 .refine / .superRefine：帶 refine 的 schema 無法乾淨地
 * 轉成 JSON Schema（我們要產一份給 Unity 端對照），而且跨欄位錯誤用扁平清單
 * 呈現給使用者，比 zod 的巢狀 issue 樹好讀得多。
 */

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  level: IssueLevel;
  /** 人類可讀的定位，例如 `scenes[0].nodes[3].next`。 */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /**
   * Zod 的**輸出**，已套用所有 .default()。
   *
   * 呼叫方必須改用這個物件，不能沿用傳進來的原始 JSON —— 舊版本的檔案缺少
   * 後來新增的選填欄位，只有 Zod 的輸出才把它們補齊。用原始物件會讓
   * 「舊檔照讀」的相容性承諾在第一次存取新欄位時就崩掉。
   */
  project?: StoryProject;
}

function majorOf(version: string): string {
  return version.split('.')[0] ?? '';
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export function checkReferences(project: StoryProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => issues.push({ level: 'warning', path, message });

  const { meta } = project;
  if (majorOf(meta.formatVersion) !== majorOf(FORMAT_VERSION)) {
    err(
      'meta.formatVersion',
      `格式主版本不符：檔案為 ${meta.formatVersion}，本編輯器支援 ${FORMAT_VERSION}`,
    );
  }
  if (!meta.languages.includes(meta.baseLanguage)) {
    err('meta.baseLanguage', `baseLanguage "${meta.baseLanguage}" 不在 languages 清單中`);
  }

  // ---- 唯一性 ----
  const nodeIds: string[] = [];
  const choiceIds: string[] = [];
  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      nodeIds.push(node.id);
      for (const choice of node.choices) choiceIds.push(choice.id);
      // 分支 id 與選項 id 共用同一個命名空間：兩者都是節點內的可跳轉目標。
      for (const branch of node.branches) choiceIds.push(branch.id);
    }
  }
  for (const [label, ids] of [
    ['scenes', project.scenes.map((s) => s.id)],
    ['nodes', nodeIds],
    ['choices', choiceIds],
    ['characters', project.characters.map((c) => c.id)],
    ['variables', project.variables.map((v) => v.id)],
  ] as const) {
    for (const dup of findDuplicates(ids)) {
      err(label, `id 重複："${dup}"。id 必須全域唯一且永不重用`);
    }
  }

  // ---- 索引 ----
  const nodeIdSet = new Set(nodeIds);
  const characterIds = new Set(project.characters.map((c) => c.id));
  const variables = new Map(project.variables.map((v) => [v.id, v]));
  const nodeToScene = new Map<string, string>();
  for (const scene of project.scenes) {
    for (const node of scene.nodes) nodeToScene.set(node.id, scene.id);
  }

  // ---- 標籤登錄表 ----
  for (const dup of findDuplicates(project.tagRegistry.map((t) => t.name))) {
    err('tagRegistry', `標籤名稱重複："${dup}"`);
  }
  project.tagRegistry.forEach((tag, i) => {
    if (tag.positional && !tag.params.some((p) => p.name === tag.positional)) {
      err(
        `tagRegistry[${i}].positional`,
        `標籤 "${tag.name}" 的位置參數 "${tag.positional}" 未定義於 params`,
      );
    }
  });

  // ---- 場景與節點 ----
  project.scenes.forEach((scene, si) => {
    const at = `scenes[${si}]`;
    if (scene.entryNodeId === null) {
      if (scene.nodes.length > 0) warn(`${at}.entryNodeId`, `場景 "${scene.name}" 未設定進入節點`);
    } else if (nodeToScene.get(scene.entryNodeId) !== scene.id) {
      err(`${at}.entryNodeId`, `進入節點 ${scene.entryNodeId} 不屬於場景 "${scene.name}"`);
    }

    scene.nodes.forEach((node, ni) => {
      const nAt = `${at}.nodes[${ni}]`;

      // 只有台詞需要文字。純選擇點（有選項、無台詞）與流程控制節點都不需要。
      if (
        node.kind === 'line' &&
        node.choices.length === 0 &&
        !node.text[meta.baseLanguage]?.trim()
      ) {
        err(`${nAt}.text.${meta.baseLanguage}`, '基準語言的台詞不可為空');
      }

      if (node.kind === 'branch') {
        if (node.branches.length === 0) err(`${nAt}.branches`, 'branch 節點至少要有一條分支');
        node.branches.forEach((branch, bi) => {
          if (!branch.condition.trim()) {
            err(`${nAt}.branches[${bi}].condition`, '分支條件不可為空');
          }
          if (branch.targetNodeId !== null && !nodeIdSet.has(branch.targetNodeId)) {
            err(`${nAt}.branches[${bi}].targetNodeId`, `分支指向不存在的節點 ${branch.targetNodeId}`);
          }
        });
      } else if (node.branches.length > 0) {
        warn(`${nAt}.branches`, `kind 為 ${node.kind} 的節點不會執行 branches`);
      }

      if ((node.kind === 'set' || node.kind === 'input') && !node.expression?.trim()) {
        err(`${nAt}.expression`, `kind 為 ${node.kind} 的節點必須有 expression`);
      }

      // `<name>` 是變數插值。找不到對應變數多半是打錯字，或誤把特效標記
      // 寫成尖括號（特效要用方括號或大括號）。
      for (const [lang, text] of Object.entries(node.text)) {
        for (const name of collectPlaceholders(text)) {
          if (!variables.has(name)) {
            warn(`${nAt}.text.${lang}`, `文字中的 <${name}> 找不到對應變數，會原樣顯示`);
          }
        }
      }

      for (const lang of Object.keys(node.text)) {
        if (!meta.languages.includes(lang)) {
          warn(`${nAt}.text.${lang}`, `語言 "${lang}" 不在 meta.languages 中，匯出時會被忽略`);
        }
      }

      if (node.speaker && !characterIds.has(node.speaker)) {
        err(`${nAt}.speaker`, `找不到角色 "${node.speaker}"`);
      }
      if (node.next !== null && !nodeIdSet.has(node.next)) {
        err(`${nAt}.next`, `next 指向不存在的節點 ${node.next}`);
      }
      if (node.choices.length > 0 && node.next !== null) {
        warn(`${nAt}.next`, '節點同時有 choices 與 next，runtime 會忽略 next');
      }

      node.choices.forEach((choice, ci) => {
        const cAt = `${nAt}.choices[${ci}]`;
        if (!choice.text[meta.baseLanguage]?.trim()) {
          err(`${cAt}.text.${meta.baseLanguage}`, '基準語言的選項文字不可為空');
        }
        if (choice.targetNodeId !== null && !nodeIdSet.has(choice.targetNodeId)) {
          err(`${cAt}.targetNodeId`, `選項指向不存在的節點 ${choice.targetNodeId}`);
        }
      });

      node.actions.forEach((action, ai) => {
        const aAt = `${nAt}.actions[${ai}]`;
        const variable = variables.get(action.variable);
        if (!variable) {
          err(`${aAt}.variable`, `找不到變數 "${action.variable}"`);
          return;
        }
        if (action.op === 'toggle') {
          if (variable.type !== 'bool') {
            err(`${aAt}.op`, `toggle 只能用於 bool 變數，"${variable.id}" 是 ${variable.type}`);
          }
          return;
        }
        if (action.value === undefined) {
          err(`${aAt}.value`, `${action.op} 需要 value`);
          return;
        }
        if (action.op === 'add' && variable.type !== 'number') {
          err(`${aAt}.op`, `add 只能用於 number 變數，"${variable.id}" 是 ${variable.type}`);
          return;
        }
        const actual = typeof action.value === 'boolean' ? 'bool' : typeof action.value;
        if (actual !== variable.type) {
          err(`${aAt}.value`, `型別不符：變數 "${variable.id}" 是 ${variable.type}，值是 ${actual}`);
        }
      });
    });
  });

  // ---- 角色 ----
  project.characters.forEach((character, i) => {
    if (!character.name[meta.baseLanguage]?.trim()) {
      err(`characters[${i}].name.${meta.baseLanguage}`, '基準語言的角色名不可為空');
    }
  });

  return issues;
}

/** 先跑 schema 再跑參照檢查。schema 失敗時不繼續，因為後續存取會不安全。 */
export function validateStoryProject(data: unknown): ValidationResult {
  const parsed = StoryProjectSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        level: 'error' as const,
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }
  const issues = checkReferences(parsed.data);
  return {
    ok: !issues.some((i) => i.level === 'error'),
    issues,
    project: parsed.data,
  };
}
