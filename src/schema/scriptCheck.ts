import { STAGE_COLUMNS } from '../legacy/format';
import { attributeTable } from '../stage/attributes';
import { parseStage } from '../stage/directives';
import type { Stage, StoryProject } from './story';
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

  const check = (sheet: string, id: string, stage: Stage | undefined) => {
    if (!stage) return;
    const parsed = parseStage(stage);
    for (const message of parsed.issues) {
      issues.push({ level: 'error', path: `${sheet} / ID ${id}`, message });
    }
    for (const change of parsed.attributes) {
      if (table.has(change.name)) continue;
      issues.push({
        level: 'error',
        path: `${sheet} / ID ${id} / ${STAGE_COLUMNS.attributes[0]}`,
        message:
          `屬性變化「${change.name}」不在屬性清單裡` +
          (known.length > 0 ? `（清單：${known.join('、')}）` : '（還沒有任何變數設定屬性名稱）'),
      });
    }
  };

  // 用來源表的寫法定位（工作表＋ID 欄），作者才能直接在 Excel 找到那一列
  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      check(scene.name, node.source?.id ?? node.id, node.stage);
      for (const choice of node.choices) check(scene.name, choice.sourceId ?? choice.id, choice.stage);
      for (const branch of node.branches) check(scene.name, branch.sourceId ?? branch.id, branch.stage);
    }
  }
  return issues;
}
