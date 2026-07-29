import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { validateStoryProject } from '../schema/validate';
import { exportLegacyWorkbook } from './export';
import { importLegacyWorkbook } from './import';

/**
 * 既有劇本格式的往返測試。
 *
 * 用程式產生來源表格而非依賴實際檔案：測試必須能獨立跑，
 * 而且失敗時看得出是哪一種列出的問題。
 */

const HEADERS = [
  '標誌', 'ID', '組', '人物', '場景', '立繪', '位置', '內容', '畫面效果', '屬性變化', '跳轉',
];

type Row = Partial<Record<string, string>>;

async function makeWorkbook(sheets: Record<string, Row[]>, headers = HEADERS): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? ''));
  }
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

/** 讀回工作表內容，供比對。 */
async function readWorkbook(data: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const out: Record<string, Row[]> = {};
  for (const sheet of workbook.worksheets) {
    const headers: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c += 1) {
      headers.push(String(sheet.getRow(1).getCell(c).text ?? '').trim());
    }
    const rows: Row[] = [];
    for (let r = 2; r <= sheet.rowCount; r += 1) {
      const row: Row = {};
      headers.forEach((h, i) => {
        const v = String(sheet.getRow(r).getCell(i + 1).text ?? '').trim();
        if (v) row[h] = v;
      });
      if (Object.keys(row).length > 0) rows.push(row);
    }
    out[sheet.name] = rows;
  }
  return out;
}

/** 涵蓋每一種標誌，以及多入口的對話 hub。 */
const SAMPLE: Record<string, Row[]> = {
  'CH-0-序章': [
    { 標誌: '#', ID: '0', 人物: 'guide', 內容: '歡迎光臨。', 跳轉: '1', 背景: '' },
    // 同組選項的人物可以不同（「（不回應）」是 system 而非玩家），
    // 而且成員之間可以互跳（1 → 2）。
    { 標誌: 'q', ID: '1', 組: 'a', 人物: 'player', 內容: '你是誰？', 跳轉: '2' },
    { 標誌: 'q', ID: '2', 組: 'a', 人物: 'system', 內容: '（不回應）', 跳轉: '6' },
    { 標誌: '', ID: '5', 人物: 'hero os', 內容: '（有點可疑。）', 跳轉: '1', 場景: '大廳' },
    { 標誌: '#', ID: '6', 人物: 'guide', 內容: '那麼開始吧。', 立繪: '便服-微笑', 跳轉: '7' },
    { 標誌: 'in', ID: '7', 人物: 'system', 內容: 'birthday', 畫面效果: 'OpenDateInput', 跳轉: '8' },
    { 標誌: 'set', ID: '8', 人物: 'system', 內容: 'age = CalcAge(birthday)', 跳轉: '9' },
    { 標誌: 'if', ID: '9', 組: 'c', 人物: 'system', 內容: 'age < 25', 跳轉: '11' },
    { 標誌: 'if', ID: '10', 組: 'c', 人物: 'system', 內容: 'age >= 25', 跳轉: '11', 屬性變化: 'courage+1' },
    { 標誌: '#', ID: '11', 人物: 'narration', 內容: '（時間流逝……）', 跳轉: '12' },
    { 標誌: 'end', ID: '12' },
  ],
  'CH-1-第二幕': [
    { 標誌: '#', ID: '0', 人物: 'Rin', 內容: '{i}{color=#606060}（又是這裡……）{/color}{/i}', 跳轉: '1' },
    { 標誌: 'end', ID: '1' },
  ],
};

describe('匯入既有劇本格式', () => {
  it('每一種標誌都對應到正確的節點種類', async () => {
    const { project, report } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');

    expect(report.scenes).toBe(2);
    expect(report.rows).toBe(13);
    // 13 列 → 11 個節點：q 群組（2 列）與 if 群組（2 列）各併成一個。
    // 台詞 6 個 = 第一幕的 0、選擇點、5、6、11，加第二幕的 0。
    expect(report.nodesByKind).toEqual({ line: 6, input: 1, set: 1, branch: 1, end: 2 });
    expect(report.choices).toBe(2);
    expect(report.branches).toBe(2);
    expect(validateStoryProject(project).ok).toBe(true);
  });

  it('保留來源的 ID、組與標誌原值', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const nodes = project.scenes[0]!.nodes;

    expect(nodes[0]!.source).toEqual({ id: '0', marker: '#', group: '' });
    // 空白標誌與 # 都是台詞，但要分辨才能原樣寫回。
    expect(nodes.find((n) => n.source?.id === '5')!.source!.marker).toBe('');
    const choicePoint = nodes.find((n) => n.choices.length > 0)!;
    expect(choicePoint.source).toEqual({ id: '1', marker: 'q', group: 'a' });
    expect(choicePoint.choices.map((c) => c.sourceId)).toEqual(['1', '2']);
  });

  it('沒有標組的連續 if 列算同一個判斷', async () => {
    // 實際劇本裡三選一的條件判斷是不標組的。若各自成為獨立節點，
    // 只有第一列接得到 —— 另外兩條路在遊戲裡永遠走不到，而且不會報錯。
    const { project } = await importLegacyWorkbook(
      await makeWorkbook({
        'CH-0': [
          { 標誌: '', ID: '0', 內容: '……', 跳轉: '1' },
          { 標誌: 'if', ID: '1', 組: '', 內容: 'composure >= 75', 跳轉: '4' },
          { 標誌: 'if', ID: '2', 組: '', 內容: 'composure <= 74', 跳轉: '5' },
          { 標誌: 'if', ID: '3', 組: '', 內容: 'composure <= 24', 跳轉: '6' },
          { 標誌: '', ID: '4', 內容: '冷靜。', 跳轉: '' },
          { 標誌: '', ID: '5', 內容: '有點慌。', 跳轉: '' },
          { 標誌: '', ID: '6', 內容: '完全慌了。', 跳轉: '' },
        ],
      }),
      '測試',
    );

    const branch = project.scenes[0]!.nodes.find((n) => n.kind === 'branch')!;
    expect(branch.branches.map((b) => b.condition)).toEqual([
      'composure >= 75',
      'composure <= 74',
      'composure <= 24',
    ]);
    expect(branch.branches.map((b) => b.sourceId)).toEqual(['1', '2', '3']);
  });

  it('中間夾了台詞的 if 列不算同一組', async () => {
    const { project } = await importLegacyWorkbook(
      await makeWorkbook({
        'CH-0': [
          { 標誌: 'if', ID: '0', 內容: 'a', 跳轉: '1' },
          { 標誌: '', ID: '1', 內容: '中間的台詞。', 跳轉: '2' },
          { 標誌: 'if', ID: '2', 內容: 'b', 跳轉: '1' },
        ],
      }),
      '測試',
    );

    const branches = project.scenes[0]!.nodes.filter((n) => n.kind === 'branch');
    expect(branches).toHaveLength(2);
  });

  it('只有標題列的工作表會建成空場景，匯出時才不會整張消失', async () => {
    const { project, report } = await importLegacyWorkbook(
      await makeWorkbook({ 'CH-0': SAMPLE['CH-0-序章']!, 'CH-1-待寫': [] }),
      '測試',
    );

    const empty = project.scenes.find((s) => s.name === 'CH-1-待寫');
    expect(empty?.nodes).toEqual([]);
    expect(report.scenes).toBe(2);

    const result = await readWorkbook(await (await exportLegacyWorkbook(project)).blob.arrayBuffer());
    expect(Object.keys(result)).toContain('CH-1-待寫');
  });

  it('保留立繪的中文命名與未支援的製作欄位', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const nodes = project.scenes[0]!.nodes;

    expect(nodes.find((n) => n.source?.id === '6')!.portrait).toBe('便服-微笑');
    expect(nodes.find((n) => n.source?.id === '5')!.extras).toEqual({ 場景: '大廳' });
    expect(nodes.find((n) => n.source?.id === '7')!.extras).toEqual({ 畫面效果: 'OpenDateInput' });
    // 群組成員各自的製作欄位掛在該成員上，不會互相污染。
    const branch = nodes.find((n) => n.kind === 'branch')!;
    expect(branch.branches.map((b) => b.extras)).toEqual([{}, { 屬性變化: 'courage+1' }]);
  });

  it('對話 hub：兩個節點跳進同一組選項，選項只有一份', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const nodes = project.scenes[0]!.nodes;
    const choicePoint = nodes.find((n) => n.choices.length > 0)!;

    expect(nodes.find((n) => n.source?.id === '0')!.next).toBe(choicePoint.id);
    expect(nodes.find((n) => n.source?.id === '5')!.next).toBe(choicePoint.id);
    expect(nodes.filter((n) => n.choices.length > 0)).toHaveLength(1);
  });

  it('同組選項各自保留自己的人物', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const choicePoint = project.scenes[0]!.nodes.find((n) => n.choices.length > 0)!;

    expect(choicePoint.choices.map((c) => c.speaker)).toEqual(['player', 'system']);
  });

  it('保留跳轉原值，即使它指向群組中的非第一列', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const choicePoint = project.scenes[0]!.nodes.find((n) => n.choices.length > 0)!;

    // 編輯器只認得「群組節點」，所以兩個選項的 targetNodeId 都指向同一個節點；
    // 但原始跳轉（1→2）必須留著，否則匯出會把它改寫成組長編號。
    expect(choicePoint.choices[0]!.sourceJump).toBe('2');
    expect(choicePoint.choices[0]!.targetNodeId).toBe(choicePoint.id);
  });

  it('narration 視為旁白，但原始標籤保留在 extras', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const node = project.scenes[0]!.nodes.find((n) => n.source?.id === '11')!;

    expect(node.speaker).toBeUndefined();
    expect(node.extras['人物']).toBe('narration');
  });

  it('從運算式萃取變數宣告，camelCase 的名稱不會被拒絕', async () => {
    const { project, report } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');

    // 變數名必須與運算式裡寫的完全一致，不能被正規化成小寫。
    expect(report.variables).toContain('birthday');
    expect(report.variables).toContain('age');
    expect(validateStoryProject(project).ok).toBe(true);

    const age = project.variables.find((v) => v.id === 'age')!;
    expect(age.type).toBe('number');
    // birthday 是 CalcAge 的參數，應推成日期而不是數字或一般文字。
    expect(project.variables.find((v) => v.id === 'birthday')!.type).toBe('date');
  });

  it('依台詞中的括號用量判定標記語法', async () => {
    const { report } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    expect(report.tagSyntax).toBe('brace');
  });

  it('空白工作表列入提醒而非靜默略過', async () => {
    const data = await makeWorkbook({ ...SAMPLE, 'CH-2-空的': [] });
    const { report } = await importLegacyWorkbook(data, '測試');
    expect(report.warnings.some((w) => w.includes('只有標題列'))).toBe(true);
  });

  it('連標題列都沒有的工作表才真的略過', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('CH-3-全空');
    const data = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const { project, report } = await importLegacyWorkbook(data, '測試');
    expect(project.scenes).toHaveLength(0);
    expect(report.warnings.some((w) => w.includes('連標題列都沒有'))).toBe(true);
  });
});

describe('匯出既有劇本格式', () => {
  it('往返後每一列的內容完全一致', async () => {
    const source = await makeWorkbook(SAMPLE);
    const { project } = await importLegacyWorkbook(source, '測試');
    const exported = await exportLegacyWorkbook(project);
    const result = await readWorkbook(await exported.blob.arrayBuffer());

    expect(Object.keys(result)).toEqual(Object.keys(SAMPLE));
    expect(exported.newIds).toBe(0);

    for (const [sheet, rows] of Object.entries(SAMPLE)) {
      const expected = rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([, v]) => v !== '' && v !== undefined)),
      );
      expect({ sheet, rows: result[sheet] }).toEqual({ sheet, rows: expected });
    }
  });

  it('改動選項的目標後，跳轉改寫成新編號而非沿用原值', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const scene = project.scenes[0]!;
    const choicePoint = scene.nodes.find((n) => n.choices.length > 0)!;
    const endNode = scene.nodes.find((n) => n.kind === 'end')!;

    // 原本 sourceJump 是 '2'（同組的第二列），改指到結束節點後不該再沿用。
    choicePoint.choices[0]!.targetNodeId = endNode.id;

    const result = await readWorkbook(await (await exportLegacyWorkbook(project)).blob.arrayBuffer());
    const row = result['CH-0-序章']!.find((r) => r['ID'] === '1')!;
    expect(row['跳轉']).toBe('12');
  });

  it('往返兩次後仍然穩定', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const first = await (await exportLegacyWorkbook(project)).blob.arrayBuffer();
    const { project: reimported } = await importLegacyWorkbook(first, '測試');
    const second = await (await exportLegacyWorkbook(reimported)).blob.arrayBuffer();

    expect(await readWorkbook(second)).toEqual(await readWorkbook(first));
  });

  it('保留各工作表原本的欄位順序', async () => {
    const other = ['標誌', 'ID', '人物', '內容', '跳轉', '選項解鎖條件'];
    const data = await makeWorkbook({ 'CH-9': [{ 標誌: '#', ID: '0', 人物: 'hero', 內容: '嗨', 跳轉: '' }] }, other);

    const { project } = await importLegacyWorkbook(data, '測試');
    expect(project.scenes[0]!.sourceColumns).toEqual(other);

    const result = await readWorkbook(await (await exportLegacyWorkbook(project)).blob.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await exportLegacyWorkbook(project)).blob.arrayBuffer());
    const headers: string[] = [];
    const sheet = workbook.worksheets[0]!;
    for (let c = 1; c <= sheet.columnCount; c += 1) {
      headers.push(String(sheet.getRow(1).getCell(c).text ?? '').trim());
    }
    expect(headers).toEqual(other);
    expect(result['CH-9']).toHaveLength(1);
  });

  it('編輯器新增的節點會配發不重複的新編號', async () => {
    const { project } = await importLegacyWorkbook(await makeWorkbook(SAMPLE), '測試');
    const scene = project.scenes[0]!;
    scene.nodes.push({
      id: '01KYJCW9TQKZDPGVV5H86A0QF2',
      kind: 'line',
      text: { zh: '這是後來加的一句。' },
      choices: [],
      next: null,
      actions: [],
      notes: '',
      branches: [],
      extras: {},
    });

    const exported = await exportLegacyWorkbook(project);
    expect(exported.newIds).toBe(1);

    const result = await readWorkbook(await exported.blob.arrayBuffer());
    const rows = result['CH-0-序章']!;
    const added = rows.find((r) => r['內容'] === '這是後來加的一句。')!;
    // 既有編號最大為 12，新列應接在後面且不與任何既有編號相撞。
    expect(added['ID']).toBe('13');
    expect(new Set(rows.map((r) => r['ID'])).size).toBe(rows.length);
  });
});
