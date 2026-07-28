import { cellKey, rowKey, type FieldName, type RowRef } from '../schema/keys';
import type { StoryProject } from '../schema/story';
import { stripTags } from '../tags/parse';

/**
 * 把專案攤平成 Excel 的列。
 *
 * 設計原則見 docs/FORMAT.md §4：Excel 是「文字欄位的可寫視圖」，
 * 分支結構與條件只以唯讀的上下文欄呈現，不開放編輯。
 */

export type RowKind = 'line' | 'choice' | 'character';

export interface WritableCell {
  field: FieldName;
  /** null 代表非多語系欄位（notes）。 */
  lang: string | null;
  value: string;
}

export interface SheetRow extends RowRef {
  key: string;
  kind: RowKind;
  /** 唯讀上下文欄。 */
  scene: string;
  speaker: string;
  context: string;
  cells: WritableCell[];
}

function displayName(
  record: Record<string, string> | undefined,
  baseLanguage: string,
): string {
  if (!record) return '';
  return record[baseLanguage] ?? Object.values(record)[0] ?? '';
}

/**
 * 列的順序是「場景 → 節點 → 該節點的選項」，最後是角色，
 * 讓翻譯者能照劇情順序閱讀。因為 key 與順序無關，重排不影響合併。
 */
export function collectRows(project: StoryProject): SheetRow[] {
  const base = project.meta.baseLanguage;
  const languages = project.meta.languages;
  const characterNames = new Map(
    project.characters.map((c) => [c.id, displayName(c.name, base)]),
  );

  const rows: SheetRow[] = [];

  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      // 流程控制節點沒有可翻譯的文字，不進翻譯表 —— 否則譯者會看到成排的空列。
      if (node.kind !== 'line') continue;

      const ref: RowRef = { ownerKind: 'node', ownerId: node.id };
      rows.push({
        ...ref,
        key: rowKey(ref),
        kind: 'line',
        scene: scene.name,
        speaker: node.speaker ? (characterNames.get(node.speaker) ?? node.speaker) : '',
        context: node.condition ? `條件：${node.condition}` : '',
        cells: [
          ...languages.map((lang) => ({
            field: 'text' as const,
            lang,
            value: node.text[lang] ?? '',
          })),
          { field: 'notes' as const, lang: null, value: node.notes },
        ],
      });

      const parentText = stripTags(node.text[base] ?? '', project.tagRegistry);
      for (const choice of node.choices) {
        const choiceRef: RowRef = { ownerKind: 'choice', ownerId: choice.id };
        rows.push({
          ...choiceRef,
          key: rowKey(choiceRef),
          kind: 'choice',
          scene: scene.name,
          speaker: '',
          context: parentText,
          cells: languages.map((lang) => ({
            field: 'text' as const,
            lang,
            value: choice.text[lang] ?? '',
          })),
        });
      }
    }
  }

  for (const character of project.characters) {
    const ref: RowRef = { ownerKind: 'character', ownerId: character.id };
    rows.push({
      ...ref,
      key: rowKey(ref),
      kind: 'character',
      scene: '',
      speaker: '',
      context: '',
      cells: languages.map((lang) => ({
        field: 'name' as const,
        lang,
        value: character.name[lang] ?? '',
      })),
    });
  }

  return rows;
}

/** 攤平成 cellKey → 值，即匯出快照的內容。 */
export function rowsToCellMap(rows: SheetRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    for (const cell of row.cells) {
      out[cellKey(row, cell.field, cell.lang)] = cell.value;
    }
  }
  return out;
}

/** 目前專案的所有可寫格內容，供合併時當作 `current`。 */
export function currentCellMap(project: StoryProject): Record<string, string> {
  return rowsToCellMap(collectRows(project));
}
