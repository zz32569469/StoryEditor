/**
 * 把既有的劇本 Excel 轉成編輯器的 .story.json（命令列版）。
 *
 *   npm run convert -- <來源.xlsx> [輸出.story.json]
 *
 * 編輯器介面上的「匯入劇本 xlsx」做的是同一件事，兩者共用 src/legacy/import.ts。
 * 這支程式適合批次處理或想在轉檔前先看報告的情況。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { importLegacyWorkbook } from '../src/legacy/import';
import { validateStoryProject } from '../src/schema/validate';

const input = process.argv[2];
if (!input) {
  console.error('用法：npm run convert -- <來源.xlsx> [輸出.story.json]');
  process.exit(1);
}

const inputPath = resolve(input);
const name = basename(inputPath).replace(/\.xlsx$/i, '');
const output = resolve(process.argv[3] ?? `${name}.story.json`);

const file = readFileSync(inputPath);
const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
const { project, report } = await importLegacyWorkbook(data, name);

console.log(`場景 ${report.scenes}，來源資料列 ${report.rows}`);
console.log('節點：', Object.entries(report.nodesByKind).map(([k, v]) => `${k}=${v}`).join('  '));
console.log(`選項 ${report.choices}，分支 ${report.branches}`);
console.log(`角色 ${report.characters.length}：${report.characters.join(', ')}`);
console.log(`標記括號：${report.tagSyntax === 'brace' ? '大括號 {b}' : '方括號 [b]'}（依台詞中實際用量判定）`);
console.log(
  '保留的製作欄位：',
  Object.entries(report.extrasKept).map(([k, v]) => `${k}(${v})`).join('  ') || '（無）',
);

if (report.warnings.length > 0) {
  console.log(`\n轉換提醒 ${report.warnings.length} 項：`);
  for (const w of report.warnings.slice(0, 20)) console.log('  ' + w);
  if (report.warnings.length > 20) console.log(`  ... 還有 ${report.warnings.length - 20} 項`);
}

const validation = validateStoryProject(project);
const errors = validation.issues.filter((i) => i.level === 'error');
const warns = validation.issues.filter((i) => i.level === 'warning');
console.log(`\n驗證：${errors.length} 錯誤，${warns.length} 提醒`);
for (const issue of [...errors, ...warns].slice(0, 20)) {
  console.log(`  [${issue.level}] ${issue.path}：${issue.message}`);
}

if (errors.length > 0) {
  console.error('\n有錯誤，未寫出檔案。');
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(project, null, 2)}\n`, 'utf8');
console.log(`\n已寫出 ${output}`);
