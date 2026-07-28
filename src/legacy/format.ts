import type { NodeKind } from '../schema/story';

/**
 * 既有劇本表格的格式定義。
 *
 * 匯入與匯出共用這一份 —— 兩邊各自定義欄位是這類工具最典型的失效方式：
 * 加一欄、改一個欄名，一邊改了另一邊沒改，資料就靜默地接錯欄。
 *
 * 來源格式：每張工作表 = 一個場景，`ID` 為表內流水號，`跳轉` 指向同表的 ID。
 */

/** 標誌欄的值 → 節點種類。空字串與 `#` 都是一般台詞。 */
export type Marker = 'line' | 'q' | 'if' | 'set' | 'in' | 'end';

export function toMarker(raw: string): Marker {
  const value = raw.trim().toLowerCase();
  if (value === 'q' || value === 'if' || value === 'set' || value === 'in' || value === 'end') {
    return value;
  }
  return 'line';
}

/**
 * 節點種類 → 標誌欄的值。
 *
 * `line` 回傳 null 代表「沿用原始標誌」：來源同時使用空白與 `#` 表示台詞，
 * 兩者沒有語意差別但要原樣寫回，因此由 node.source.marker 決定。
 */
export function markerFor(kind: NodeKind, hasChoices: boolean): string | null {
  if (kind === 'branch') return 'if';
  if (kind === 'set') return 'set';
  if (kind === 'input') return 'in';
  if (kind === 'end') return 'end';
  return hasChoices ? 'q' : null;
}

/** 有語意的欄位。同義欄名列在一起（不同工作表用了不同稱呼）。 */
export const COLUMN_ALIASES = {
  marker: ['標誌'],
  id: ['ID'],
  group: ['組'],
  person: ['人物'],
  portrait: ['立繪'],
  content: ['內容'],
  jump: ['跳轉'],
} as const;

export type SemanticColumn = keyof typeof COLUMN_ALIASES;

/** 所有有語意的欄名（含同義字），用來判斷一個欄位是否該進 extras。 */
export const SEMANTIC_HEADERS = new Set<string>(
  Object.values(COLUMN_ALIASES).flatMap((names) => [...names]),
);

/**
 * 匯出時的預設欄位順序。
 *
 * 只有在場景沒有記錄 `sourceColumns` 時才用（例如編輯器裡新建的場景）。
 * 取自來源檔中最完整的一張工作表。
 */
export const DEFAULT_COLUMNS = [
  '標誌',
  'ID',
  '組',
  '人物',
  '場景',
  '立繪',
  '位置',
  '立繪效果',
  '插圖',
  '內容',
  '畫面效果',
  '效果音',
  'OST',
  '屬性變化',
  '物品消耗',
  '功能解鎖',
  '作用目標',
  '選項解鎖',
  '跳轉',
];

/** 在表頭中找出某個語意欄位的欄號（1-based，0 代表找不到）。 */
export function findColumn(headers: string[], column: SemanticColumn): number {
  for (const alias of COLUMN_ALIASES[column]) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index + 1;
  }
  return 0;
}
