import type { Workbook } from 'exceljs';

import { cellKey } from '../schema/keys';
import type { ExportSnapshot, StoryProject } from '../schema/story';
import { collectRows, type SheetRow } from './rows';
import {
  CHARACTER_SHEET,
  DIALOGUE_SHEET,
  README_LINES,
  README_SHEET,
  characterColumns,
  dialogueColumns,
  isWritable,
  type ColumnSpec,
} from './sheets';

const HEADER_FILL = 'FF2F3437';
const HEADER_FONT = 'FFFFFFFF';
const READONLY_FILL = 'FFF1F1F1';

function writeSheet(
  workbook: Workbook,
  name: string,
  columns: ColumnSpec[],
  rows: SheetRow[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: HEADER_FONT } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;

  // 首列凍結，讓翻譯者捲到第 300 列時還看得到欄名。
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const values = columns.map((column) => {
      if (column.cell) {
        const found = row.cells.find(
          (c) => c.field === column.cell!.field && c.lang === column.cell!.lang,
        );
        return found?.value ?? '';
      }
      return column.read?.(row) ?? '';
    });
    const added = sheet.addRow(values);
    added.alignment = { vertical: 'top', wrapText: true };

    columns.forEach((column, index) => {
      if (isWritable(column)) return;
      // 唯讀欄加灰底。這是降低誤改機率的提示，不是保證 ——
      // 匯入時仍會逐欄比對，唯讀欄的變更一律忽略並列入報告。
      added.getCell(index + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: READONLY_FILL },
      };
    });
  }

  columns.forEach((column, index) => {
    if (column.hidden) sheet.getColumn(index + 1).hidden = true;
  });
}

function writeReadme(workbook: Workbook): void {
  const sheet = workbook.addWorksheet(README_SHEET);
  sheet.getColumn(1).width = 100;
  for (const line of README_LINES) {
    const row = sheet.addRow([line]);
    if (line.startsWith('【')) row.font = { bold: true };
  }
}

export interface ExportResult {
  blob: Blob;
  /** 寫回專案，作為下次匯入時的三方合併基準。 */
  snapshot: ExportSnapshot;
  rowCount: number;
}

/**
 * 匯出 xlsx。
 *
 * 同時產生快照 —— 沒有它，下次匯入就無法分辨「Excel 改了」與「編輯器改了」，
 * 只能退化成整份覆蓋。呼叫方**必須**把 snapshot 寫回專案。
 */
export async function exportWorkbook(project: StoryProject): Promise<ExportResult> {
  const rows = collectRows(project);
  // 動態載入：ExcelJS 佔了 bundle 的絕大部分，但只有按下匯出／匯入才用得到。
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'StoryEditor';
  workbook.created = new Date();

  writeReadme(workbook);
  writeSheet(
    workbook,
    DIALOGUE_SHEET,
    dialogueColumns(project),
    rows.filter((r) => r.kind !== 'character'),
  );
  writeSheet(
    workbook,
    CHARACTER_SHEET,
    characterColumns(project),
    rows.filter((r) => r.kind === 'character'),
  );

  const values: Record<string, string> = {};
  for (const row of rows) {
    for (const cell of row.cells) values[cellKey(row, cell.field, cell.lang)] = cell.value;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    snapshot: { exportedAt: new Date().toISOString(), values },
    rowCount: rows.length,
  };
}
