import { ATTRIBUTE_COLUMN, attributeTable, parseAttributeChanges } from '../stage/attributes';
import type { StoryProject } from './story';
import type { ValidationIssue } from './validate';

/**
 * 劇本內容檢查：寫法本身合法、但多半是寫錯的地方。
 *
 * 跟 checkReferences 分開，是因為這些錯誤**不該擋下匯入或開檔** ——
 * 劇本由作者在 Excel 裡改，工具要做的是把每一處列出來（哪張表、哪個 ID），
 * 而不是拒絕載入或自作主張地修正。
 */
export function checkScript(project: StoryProject): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const table = attributeTable(project.variables);
  const known = [...new Set(project.variables.map((v) => v.label?.trim()).filter(Boolean))];

  const check = (where: string, extras: Record<string, string>) => {
    const text = extras[ATTRIBUTE_COLUMN];
    if (!text) return;
    const { changes, malformed } = parseAttributeChanges(text);
    for (const part of malformed) {
      issues.push({
        level: 'error',
        path: where,
        message: `屬性變化「${part}」看不懂，寫法是「名稱±數字」，多個用「，」分隔`,
      });
    }
    for (const change of changes) {
      if (table.has(change.name)) continue;
      issues.push({
        level: 'error',
        path: where,
        message:
          `屬性變化「${change.name}」不在屬性清單裡` +
          (known.length > 0 ? `（清單：${known.join('、')}）` : '（還沒有任何變數設定屬性名稱）'),
      });
    }
  };

  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      // q／if 群組節點身上的 extras 是第一列的複本（匯出時用選項／分支自己那份），只檢查成員，免得同一格報兩次
      const isGroup = node.choices.length > 0 || node.kind === 'branch';
      if (!isGroup) check(locate(scene.name, node.source?.id ?? node.id), node.extras);
      for (const choice of node.choices) check(locate(scene.name, choice.sourceId ?? choice.id), choice.extras);
      for (const branch of node.branches) check(locate(scene.name, branch.sourceId ?? branch.id), branch.extras);
    }
  }
  return issues;
}

/** 用來源表的寫法定位（工作表＋ID 欄），作者才能直接在 Excel 找到那一列。 */
function locate(sheet: string, id: string): string {
  return `${sheet} / ID ${id} / ${ATTRIBUTE_COLUMN}`;
}
