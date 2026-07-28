import type { Cell, Worksheet } from 'exceljs';

import { cellKey, parseRowKey } from '../schema/keys';
import type { StoryProject } from '../schema/story';
import { collectRows, type SheetRow } from './rows';
import {
  CHARACTER_SHEET,
  DIALOGUE_SHEET,
  ROW_KEY_HEADER,
  characterColumns,
  dialogueColumns,
  type ColumnSpec,
} from './sheets';

export interface ReadResult {
  /** cellKey -> Excel 中的值。 */
  incoming: Record<string, string>;
  /** 唯讀欄被改動的紀錄，僅提示，不套用。 */
  readonlyEdits: { rowKey: string; column: string; was: string; now: string }[];
  /** 檔案結構層級的問題（缺欄位等）。 */
  problems: string[];
  /**
   * 這份檔案根本不是編輯器匯出的格式。
   *
   * 與「有格式但內容有問題」要分開處理：拿既有劇本直接餵進來是很自然的誤用，
   * 此時該告訴使用者去用轉換器，而不是丟一份 0 筆變更的合併報告給他看。
   */
  notEditorWorkbook: boolean;
  /** 檔案裡實際有哪些工作表，用於錯誤訊息。 */
  sheetNames: string[];
}

/**
 * ExcelJS 的 cell.value 可能是字串、數字、公式物件或 rich text。
 * `cell.text` 會統一成顯示字串，正是我們要的 —— 但空白格會給出 ''，
 * 而 null/undefined 要另外擋掉。
 */
function cellText(cell: Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  return String(cell.text ?? '');
}

function readSheet(
  sheet: Worksheet | undefined,
  columns: ColumnSpec[],
  rowsByKey: Map<string, SheetRow>,
  result: ReadResult,
): void {
  // 缺工作表由 readWorkbook 統一判斷並回報，這裡靜默略過。
  if (!sheet) return;

  // 依「欄名」對應而非欄位順序 —— 使用者可能會移動或隱藏欄。
  const headerRow = sheet.getRow(1);
  const indexByHeader = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const header = cellText(cell).trim();
    if (header) indexByHeader.set(header, colNumber);
  });

  const keyIndex = indexByHeader.get(ROW_KEY_HEADER);
  if (keyIndex === undefined) {
    result.problems.push(
      `工作表 "${sheet.name}" 缺少 ${ROW_KEY_HEADER} 欄。這一欄是對齊用的，`
        + '請不要刪除它（它預設是隱藏的）。',
    );
    return;
  }

  for (const column of columns) {
    if (column.header !== ROW_KEY_HEADER && !indexByHeader.has(column.header)) {
      result.problems.push(`工作表 "${sheet.name}" 缺少欄位 "${column.header}"，該欄將被略過`);
    }
  }

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const key = cellText(row.getCell(keyIndex)).trim();
    if (!key) continue;

    const ref = parseRowKey(key);
    if (!ref) {
      result.problems.push(`工作表 "${sheet.name}" 第 ${rowNumber} 列的 ${ROW_KEY_HEADER} 格式不正確：${key}`);
      continue;
    }

    const known = rowsByKey.get(key);

    for (const column of columns) {
      const colIndex = indexByHeader.get(column.header);
      if (colIndex === undefined) continue;
      const value = cellText(row.getCell(colIndex));

      if (column.cell) {
        // Dialogue 表的 notes 欄只對台詞列有意義 —— 選項列在同一張表上，
        // 但沒有 notes 欄位。以該列實際宣告的儲存格為準，避免產生幽靈 key。
        const declared =
          !known ||
          known.cells.some((c) => c.field === column.cell!.field && c.lang === column.cell!.lang);
        if (declared) result.incoming[cellKey(ref, column.cell.field, column.cell.lang)] = value;
        continue;
      }

      // 唯讀欄：只比對，不採用。
      if (known && column.read) {
        const expected = column.read(known);
        if (value !== expected) {
          result.readonlyEdits.push({ rowKey: key, column: column.header, was: expected, now: value });
        }
      }
    }
  }
}

export async function readWorkbook(
  data: ArrayBuffer,
  project: StoryProject,
): Promise<ReadResult> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const rowsByKey = new Map(collectRows(project).map((row) => [row.key, row]));
  const sheetNames = workbook.worksheets.map((w) => w.name);

  const dialogue = workbook.getWorksheet(DIALOGUE_SHEET);
  const characters = workbook.getWorksheet(CHARACTER_SHEET);

  const result: ReadResult = {
    incoming: {},
    readonlyEdits: [],
    problems: [],
    notEditorWorkbook: !dialogue && !characters,
    sheetNames,
  };

  if (result.notEditorWorkbook) return result;

  readSheet(dialogue, dialogueColumns(project), rowsByKey, result);
  readSheet(characters, characterColumns(project), rowsByKey, result);

  return result;
}
