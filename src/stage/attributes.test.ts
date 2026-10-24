import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { importLegacyWorkbook } from '../legacy/import';
import { checkScript } from '../schema/scriptCheck';
import { parseAttributeChanges } from './attributes';

describe('屬性變化的寫法', () => {
  it('名稱±數字，全形逗號分隔', () => {
    expect(parseAttributeChanges('信任+1，幹勁-1')).toEqual({
      changes: [
        { name: '信任', delta: 1 },
        { name: '幹勁', delta: -1 },
      ],
      malformed: [],
    });
  });

  it('半形逗號、多餘空白、全形正負號與 EXP 結尾的名稱都收', () => {
    expect(parseAttributeChanges(' 親切度EXP + 3 , 幹勁－2，信任＋1 ').changes).toEqual([
      { name: '親切度EXP', delta: 3 },
      { name: '幹勁', delta: -2 },
      { name: '信任', delta: 1 },
    ]);
  });

  it('看不懂的片段原樣列出，不猜', () => {
    expect(parseAttributeChanges('信任1，幹勁+，+2').malformed).toEqual(['信任1', '幹勁+', '+2']);
  });

  it('空白格沒有任何變化', () => {
    expect(parseAttributeChanges('')).toEqual({ changes: [], malformed: [] });
  });
});

// ---------------------------------------------------------------- 劇本檢查

const HEADERS = ['標誌', 'ID', '組', '人物', '內容', '屬性變化', '跳轉'];
type Row = Partial<Record<string, string>>;

async function workbook(sheets: Record<string, Row[]>): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = wb.addWorksheet(name);
    sheet.addRow(HEADERS);
    for (const row of rows) sheet.addRow(HEADERS.map((h) => row[h] ?? ''));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** 中性範例：咖啡店開幕前一天。第 2、4 列故意把「親切度EXP」打成「新切度EXP」。 */
const CAFE: Record<string, Row[]> = {
  '開幕前一天': [
    { 標誌: '#', ID: '0', 人物: '店長', 內容: '早安。', 屬性變化: '信任+1', 跳轉: '1' },
    { 標誌: '#', ID: '1', 人物: '新人', 內容: '請多指教！', 屬性變化: '親切度EXP+2，幹勁+1', 跳轉: '2' },
    { 標誌: '#', ID: '2', 人物: '店長', 內容: '先把杯子擦乾淨。', 屬性變化: '新切度EXP+1', 跳轉: '3' },
    { 標誌: 'q', ID: '3', 組: 'a', 人物: '新人', 內容: '好的', 屬性變化: '幹勁-1', 跳轉: '5' },
    { 標誌: 'q', ID: '4', 組: 'a', 人物: '新人', 內容: '我先去倒垃圾', 屬性變化: '新切度EXP+1，信任+', 跳轉: '5' },
    { 標誌: 'end', ID: '5' },
  ],
};

async function importWithList() {
  const first = await importLegacyWorkbook(await workbook(CAFE), '咖啡店');
  // 作者在變數面板設好屬性清單（label）
  first.project.variables.push(
    { id: 'trust', type: 'number', default: 0, description: '', label: '信任' },
    { id: 'motivation', type: 'number', default: 0, description: '', label: '幹勁' },
    { id: 'kindnessExp', type: 'number', default: 0, description: '', label: '親切度EXP' },
  );
  return first.project;
}

describe('屬性清單檢查', () => {
  it('清單外的名稱逐一列出工作表與 ID，不自動修正', async () => {
    const project = await importWithList();
    const issues = checkScript(project);

    expect(issues.map((i) => `${i.path}｜${i.message.split('（')[0]}`).sort()).toEqual([
      '開幕前一天 / ID 2 / 屬性變化｜屬性變化「新切度EXP」不在屬性清單裡',
      '開幕前一天 / ID 4｜屬性變化「信任+」看不懂，寫法是「名稱±數字」，多個用「，」分隔',
      '開幕前一天 / ID 4 / 屬性變化｜屬性變化「新切度EXP」不在屬性清單裡',
    ].sort());
    expect(issues.every((i) => i.level === 'error')).toBe(true);
    expect(issues[0]!.message).toContain('清單：信任、幹勁、親切度EXP');
    // 原文不動：劇本由作者自己改
    const node = project.scenes[0]!.nodes.find((n) => n.source?.id === '2')!;
    expect(node.stage?.attributes).toBe('新切度EXP+1');
  });

  it('名稱也可以直接寫變數 id', async () => {
    const project = await importWithList();
    project.scenes[0]!.nodes[0]!.stage = { attributes: 'trust+1' };
    expect(checkScript(project).filter((i) => i.path.includes('ID 0 '))).toEqual([]);
  });

  it('還沒設定任何屬性名稱時，提示要去變數面板設定', async () => {
    const { project } = await importLegacyWorkbook(await workbook(CAFE), '咖啡店');
    const issues = checkScript(project);
    expect(issues.length).toBe(7);   // 6 個名稱＋1 個看不懂
    expect(issues[0]!.message).toContain('還沒有任何變數設定屬性名稱');
  });

  it('重新匯入沿用前一份的變數宣告，屬性清單不會被洗掉', async () => {
    const project = await importWithList();
    const { project: again } = await importLegacyWorkbook(await workbook(CAFE), '咖啡店', project);

    expect(again.variables.find((v) => v.id === 'kindnessExp')?.label).toBe('親切度EXP');
    expect(checkScript(again)).toHaveLength(3);
  });
});
