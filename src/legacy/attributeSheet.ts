import type { Workbook, Worksheet } from 'exceljs';

import type { Variable } from '../schema/story';

/**
 * 劇本檔裡的「屬性清單」工作表：宣告「屬性變化」欄可以寫哪些名稱、各自對到哪個變數。
 *
 * 讓白名單跟著劇本走 —— 作者在 Excel 裡就能維護，不必另外到編輯器的變數面板設定，
 * 命令列轉檔也讀得到。這張表不是場景，匯入時不會變成場景。
 *
 * | 屬性名稱 | 變數 | 預設值 | 說明 |
 * | 信任 | trust | 0 | 店長對新人的信任 |
 */

export const ATTRIBUTE_SHEET = '屬性清單';
export const ATTRIBUTE_HEADERS = ['屬性名稱', '變數', '預設值', '說明'] as const;

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
  const [labelCol, idCol, defaultCol, descCol] = ATTRIBUTE_HEADERS.map(col);
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
    const rawDefault = get(defaultCol);
    const value = rawDefault === '' ? 0 : Number(rawDefault);
    if (!Number.isFinite(value)) {
      warnings.push(`「${ATTRIBUTE_SHEET}」第 ${r} 列：預設值「${rawDefault}」不是數字，改用 0`);
    }
    variables.push({
      id,
      type: 'number',
      default: Number.isFinite(value) ? value : 0,
      description: get(descCol),
      label,
    });
  }
  return variables;
}

/** 把有屬性名稱的變數寫成「屬性清單」工作表；沒有就不建表。 */
export function writeAttributeSheet(workbook: Workbook, variables: Variable[]): void {
  const listed = variables.filter((v) => v.label?.trim());
  if (listed.length === 0) return;
  const sheet = workbook.addWorksheet(ATTRIBUTE_SHEET);
  sheet.columns = ATTRIBUTE_HEADERS.map((header) => ({ header, key: header, width: header === '說明' ? 30 : 14 }));
  sheet.getRow(1).font = { bold: true };
  for (const v of listed) {
    sheet.addRow([v.label!, v.id, String(v.default), v.description]);
  }
}
