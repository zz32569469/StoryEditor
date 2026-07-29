import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { importLegacyWorkbook } from '../src/legacy/import';
import { exportLegacyWorkbook } from '../src/legacy/export';

/** 匯入 → 匯出 → 逐格比對，確認來源劇本原樣往返。 */
const source = process.argv[2]!;
const buffer = readFileSync(source);

const { project } = await importLegacyWorkbook(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  '往返測試',
);
const result = await exportLegacyWorkbook(project);

const before = new ExcelJS.Workbook();
await before.xlsx.readFile(source);
const after = new ExcelJS.Workbook();
await after.xlsx.load(await result.blob.arrayBuffer());

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join('');
  }
  return String(v).trim();
};

let cells = 0;
let diffs = 0;
for (const sheetBefore of before.worksheets) {
  const sheetAfter = after.worksheets.find((w) => w.name === sheetBefore.name);
  if (!sheetAfter) {
    console.log(`✗ 缺少工作表「${sheetBefore.name}」`);
    diffs += 1;
    continue;
  }

  const headers: string[] = [];
  sheetBefore.getRow(1).eachCell((cell, col) => (headers[col] = text(cell.value)));

  for (let r = 1; r <= sheetBefore.rowCount; r += 1) {
    for (let c = 1; c < headers.length; c += 1) {
      const a = text(sheetBefore.getRow(r).getCell(c).value);
      const b = text(sheetAfter.getRow(r).getCell(c).value);
      if (a === '' && b === '') continue;
      cells += 1;
      if (a !== b) {
        diffs += 1;
        if (diffs <= 10) {
          console.log(`✗ ${sheetBefore.name} 第${r}列「${headers[c]}」：${JSON.stringify(a)} → ${JSON.stringify(b)}`);
        }
      }
    }
  }
}

console.log(`\n比對 ${cells} 格，差異 ${diffs} 格`);
