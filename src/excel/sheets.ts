import type { FieldName } from '../schema/keys';
import type { StoryProject } from '../schema/story';
import type { SheetRow } from './rows';

/**
 * 工作表欄位規格 —— 匯出與匯入共用這一份。
 *
 * 兩邊各自定義欄位是這類工具最典型的失效方式：加一個語言、改一個欄名，
 * 匯出改了匯入沒改，資料就靜默地接錯欄。
 */

export const DIALOGUE_SHEET = 'Dialogue';
export const CHARACTER_SHEET = 'Characters';
export const README_SHEET = '_README';

export const ROW_KEY_HEADER = 'row_key';

export interface ColumnSpec {
  header: string;
  width: number;
  /** 可寫欄：對應到專案中的 (欄位, 語言)。未設定即為唯讀上下文欄。 */
  cell?: { field: FieldName; lang: string | null };
  /** 唯讀欄的取值方式。 */
  read?: (row: SheetRow) => string;
  hidden?: boolean;
  wrap?: boolean;
}

export function isWritable(column: ColumnSpec): boolean {
  return column.cell !== undefined;
}

export function dialogueColumns(project: StoryProject): ColumnSpec[] {
  return [
    { header: ROW_KEY_HEADER, width: 34, hidden: true, read: (r) => r.key },
    { header: 'scene', width: 16, read: (r) => r.scene },
    { header: 'kind', width: 8, read: (r) => r.kind },
    { header: 'speaker', width: 12, read: (r) => r.speaker },
    { header: 'context', width: 30, read: (r) => r.context, wrap: true },
    { header: 'notes', width: 24, cell: { field: 'notes', lang: null }, wrap: true },
    ...project.meta.languages.map((lang) => ({
      header: `text_${lang}`,
      width: 46,
      cell: { field: 'text' as const, lang },
      wrap: true,
    })),
  ];
}

export function characterColumns(project: StoryProject): ColumnSpec[] {
  return [
    { header: ROW_KEY_HEADER, width: 34, hidden: true, read: (r) => r.key },
    { header: 'char_id', width: 20, read: (r) => r.ownerId },
    ...project.meta.languages.map((lang) => ({
      header: `name_${lang}`,
      width: 24,
      cell: { field: 'name' as const, lang },
    })),
  ];
}

export const README_LINES = [
  '這份 Excel 是劇情編輯器匯出的「文字視圖」，改完之後匯回編輯器。',
  '',
  '【可以改的欄】',
  '  notes        給自己或譯者的備註',
  '  text_xx      各語言的台詞／選項文字（xx 為語言代碼）',
  '  name_xx      各語言的角色名（Characters 工作表）',
  '',
  '【不要改的欄（灰底）】',
  '  scene / kind / speaker / context',
  '  這些是給你判讀情境用的，改了不會生效，匯入時會被忽略並列在報告中。',
  '',
  '【絕對不要做的事】',
  '  1. 不要刪除或重新排序整列 —— 每列有隱藏的對齊用編號，刪了就接不回去。',
  '  2. 不要插入新列 —— 新台詞請在編輯器裡加。',
  '  3. 不要動括號標記，例如 [shake]、{color=#606060}、{size=130%}、[wait=0.5]。',
  '     它們是文字特效。方括號與大括號都可以，但必須成對保留：',
  '       正確  You think that will keep you [shake]alive[/shake]?',
  '       錯誤  You think that will keep you [shake]alive?',
  '       錯誤  {i}開頭用大括號[/i]結尾卻用方括號',
  '     標記壞掉的儲存格匯入時會被擋下，不會靜默套用。',
  '  4. 文字裡若要出現字面上的「[」或「{」，請寫成「\\[」「\\{」。',
  '',
  '【衝突】',
  '  如果同一格在編輯器和這份 Excel 都被改過，匯入時會列為衝突，',
  '  由編輯器的使用者決定採用哪一邊 —— 不會自動覆蓋。',
];
