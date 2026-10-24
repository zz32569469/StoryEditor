import type { Workbook, Worksheet } from 'exceljs';

import type { Variable, VariableType } from '../schema/story';

/**
 * 劇本檔裡的「屬性清單」工作表：宣告「屬性變化」欄可以寫哪些名稱、各自對到哪個變數。
 *
 * 讓白名單跟著劇本走 —— 作者在 Excel 裡就能維護，不必另外到編輯器的變數面板設定，
 * 命令列轉檔也讀得到。這張表不是場景，匯入時不會變成場景。
 *
 * | 屬性名稱 | 變數 | 預設值 | 說明 | 型別 |
 * | 信任 | trust | 0 | 店長對新人的信任 | |
 * | 新人的名字 | newcomerName | | | 文字 |
 *
 * 「型別」欄可省略，預設數字。文字／日期變數也能列在這裡：屬性名稱就是輸入欄給玩家看的標題
 * （例如「新人的名字」，而不是 newcomerName）；屬性變化只能加減數字變數。
 */

export const ATTRIBUTE_SHEET = '屬性清單';
export const ATTRIBUTE_HEADERS = ['屬性名稱', '變數', '預設值', '說明', '型別'] as const;

const TYPE_NAMES: Record<string, VariableType> = {
  數字: 'number', 文字: 'string', 日期: 'date', 是否: 'bool',
  number: 'number', string: 'string', date: 'date', bool: 'bool',
};
const TYPE_LABELS: Record<VariableType, string> = { number: '數字', string: '文字', date: '日期', bool: '是否' };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isAttributeSheet(name: string): boolean {
  return name.trim() === ATTRIBUTE_SHEET;
}

/** 讀出屬性宣告；寫錯的列記進 warnings 並略過。 */
export function readAttributeSheet(sheet: Worksheet, warnings: string[]): Variable[] {
  const headers: string[] = [];
  for (let c = 1; c <= sheet.columnCount; c += 1) {
    headers.push(String(sheet.getRow(1).getCell(c).text ?? '').trim());
  }
  const col = (name: string) => headers.indexOf(name) + 1;
  const [labelCol, idCol, defaultCol, descCol, typeCol] = ATTRIBUTE_HEADERS.map(col);
  if (!labelCol || !idCol) {
    warnings.push(`「${ATTRIBUTE_SHEET}」工作表要有「屬性名稱」與「變數」兩欄，已略過`);
    return [];
  }

  const variables: Variable[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const get = (c: number | undefined) => (c ? String(row.getCell(c).text ?? '').trim() : '');
    const label = get(labelCol);
    const id = get(idCol);
    if (!label && !id) continue;
    if (!label || !IDENTIFIER.test(id)) {
      warnings.push(`「${ATTRIBUTE_SHEET}」第 ${r} 列：屬性名稱與變數都要填，變數只能用英數與底線（不能以數字開頭）`);
      continue;
    }
    const rawType = get(typeCol);
    const type = rawType === '' ? 'number' : TYPE_NAMES[rawType];
    if (!type) {
      warnings.push(`「${ATTRIBUTE_SHEET}」第 ${r} 列：型別「${rawType}」看不懂（數字／文字／日期／是否），已略過`);
      continue;
    }
    variables.push({ id, type, default: defaultOf(type, get(defaultCol), r, warnings), description: get(descCol), label });
  }
  return variables;
}

function defaultOf(type: VariableType, raw: string, row: number, warnings: string[]): Variable['default'] {
  if (type === 'string' || type === 'date') return raw;
  if (type === 'bool') return raw === 'true' || raw === '是';
  const value = raw === '' ? 0 : Number(raw);
  if (Number.isFinite(value)) return value;
  warnings.push(`「${ATTRIBUTE_SHEET}」第 ${row} 列：預設值「${raw}」不是數字，改用 0`);
  return 0;
}

/** 把有屬性名稱的變數寫成「屬性清單」工作表；沒有就不建表。 */
export function writeAttributeSheet(workbook: Workbook, variables: Variable[]): void {
  const listed = variables.filter((v) => v.label?.trim());
  if (listed.length === 0) return;
  const sheet = workbook.addWorksheet(ATTRIBUTE_SHEET);
  sheet.columns = ATTRIBUTE_HEADERS.map((header) => ({ header, key: header, width: header === '說明' ? 30 : 14 }));
  sheet.getRow(1).font = { bold: true };
  for (const v of listed) {
    sheet.addRow([v.label!, v.id, String(v.default), v.description, TYPE_LABELS[v.type]]);
  }
}
