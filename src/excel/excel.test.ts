import { describe, expect, it } from 'vitest';

import { createChoice, createEmptyProject, createNode, createScene } from '../schema/factory';
import { cellKey } from '../schema/keys';
import { DEFAULT_TAG_REGISTRY } from '../schema/tags';
import type { StoryProject } from '../schema/story';
import { applyCells } from '../sync/apply';
import { defaultDecisions, mergeCells, resolveAccepted, summarize } from '../sync/merge';
import { exportWorkbook } from './export';
import { readWorkbook } from './import';
import { currentCellMap } from './rows';

function makeProject(): StoryProject {
  const project = createEmptyProject('Excel 往返測試', ['zh', 'en']);
  project.characters = [{ id: 'warden', name: { zh: '看守者', en: 'The Warden' } }];

  const ending = createNode({ text: { zh: '結束。', en: 'The end.' } });
  const opening = createNode({
    speaker: 'warden',
    text: {
      zh: '[speed=0.6]又一個。[/speed]你以為換個顏色，就能[shake amp=3]活下來[/shake]嗎？',
      en: '[speed=0.6]Another one.[/speed]You think colors will keep you [shake amp=3]alive[/shake]?',
    },
    notes: '第一次見到看守者。\n語氣要平靜。',
    choices: [
      createChoice({ text: { zh: '「我不是來活下來的。」', en: '"I\'m not here to survive."' }, targetNodeId: ending.id }),
      createChoice({ text: { zh: '（沉默）', en: '(Say nothing)' }, targetNodeId: ending.id }),
    ],
  });
  project.scenes = [createScene('第一幕', [opening, ending])];
  return project;
}

async function roundTrip(project: StoryProject) {
  const exported = await exportWorkbook(project);
  const buffer = await exported.blob.arrayBuffer();
  const read = await readWorkbook(buffer, project);
  return { exported, read };
}

describe('xlsx 往返', () => {
  it('匯出再讀回，所有可寫格內容一字不差', async () => {
    const project = makeProject();
    const { read } = await roundTrip(project);

    expect(read.problems).toEqual([]);
    expect(read.readonlyEdits).toEqual([]);
    expect(read.incoming).toEqual(currentCellMap(project));
  });

  it('特效標記在往返中原封不動', async () => {
    const project = makeProject();
    const nodeId = project.scenes[0]!.nodes[0]!.id;
    const { read } = await roundTrip(project);

    expect(read.incoming[cellKey({ ownerKind: 'node', ownerId: nodeId }, 'text', 'zh')]).toBe(
      project.scenes[0]!.nodes[0]!.text.zh,
    );
  });

  it('備註中的換行被保留', async () => {
    const project = makeProject();
    const nodeId = project.scenes[0]!.nodes[0]!.id;
    const { read } = await roundTrip(project);

    expect(read.incoming[cellKey({ ownerKind: 'node', ownerId: nodeId }, 'notes', null)]).toBe(
      '第一次見到看守者。\n語氣要平靜。',
    );
  });

  it('匯出產生的快照等同當下的專案內容', async () => {
    const project = makeProject();
    const { exported } = await roundTrip(project);

    expect(exported.snapshot.values).toEqual(currentCellMap(project));
  });

  it('原封不動地匯回不產生任何變更', async () => {
    const project = makeProject();
    const { exported, read } = await roundTrip(project);

    const report = mergeCells({
      base: exported.snapshot.values,
      current: currentCellMap(project),
      incoming: read.incoming,
      registry: project.tagRegistry,
    });

    expect(summarize(report)).toMatchObject({ applied: 0, conflict: 0, invalid: 0 });
    expect(report.unknownRows).toEqual([]);
    expect(report.missingRows).toEqual([]);
  });
});

describe('計畫的 M1 驗收情境', () => {
  it('匯出後只改動幾格，匯回時其餘內容完全不變', async () => {
    const project = makeProject();
    const exported = await exportWorkbook(project);
    project.exportSnapshot = exported.snapshot;

    // 模擬譯者在 Excel 裡改了兩格英文。
    const buffer = await exported.blob.arrayBuffer();
    const read = await readWorkbook(buffer, project);
    const nodeId = project.scenes[0]!.nodes[0]!.id;
    const choiceId = project.scenes[0]!.nodes[0]!.choices[0]!.id;
    const editedKeys = [
      cellKey({ ownerKind: 'node', ownerId: nodeId }, 'text', 'en'),
      cellKey({ ownerKind: 'choice', ownerId: choiceId }, 'text', 'en'),
    ];
    read.incoming[editedKeys[0]!] = 'Another one. You think colors will keep you [shake amp=3]breathing[/shake]?';
    read.incoming[editedKeys[1]!] = '"Survival was never the point."';

    const before = currentCellMap(project);
    const report = mergeCells({
      base: project.exportSnapshot!.values,
      current: before,
      incoming: read.incoming,
      registry: project.tagRegistry,
    });

    expect(summarize(report)).toMatchObject({ applied: 2, conflict: 0, invalid: 0 });

    applyCells(project, resolveAccepted(report, defaultDecisions(report)));
    const after = currentCellMap(project);

    const changed = Object.keys(after).filter((key) => after[key] !== before[key]);
    expect(changed.sort()).toEqual(editedKeys.sort());
  });

  it('譯者弄壞標籤時擋下該格，其餘正常套用', async () => {
    const project = makeProject();
    const exported = await exportWorkbook(project);
    const read = await readWorkbook(await exported.blob.arrayBuffer(), project);

    const nodeId = project.scenes[0]!.nodes[0]!.id;
    const choiceId = project.scenes[0]!.nodes[0]!.choices[0]!.id;
    const brokenKey = cellKey({ ownerKind: 'node', ownerId: nodeId }, 'text', 'en');
    const goodKey = cellKey({ ownerKind: 'choice', ownerId: choiceId }, 'text', 'en');

    read.incoming[brokenKey] = 'You think colors will keep you [shake amp=3]alive?';
    read.incoming[goodKey] = '"Survival was never the point."';

    const report = mergeCells({
      base: exported.snapshot.values,
      current: currentCellMap(project),
      incoming: read.incoming,
      registry: project.tagRegistry,
    });

    expect(summarize(report)).toMatchObject({ applied: 1, invalid: 1 });

    const originalEnglish = project.scenes[0]!.nodes[0]!.text.en;
    applyCells(project, resolveAccepted(report, defaultDecisions(report)));

    expect(project.scenes[0]!.nodes[0]!.text.en).toBe(originalEnglish);
    expect(project.scenes[0]!.nodes[0]!.choices[0]!.text.en).toBe('"Survival was never the point."');
  });
});

describe('餵進不是編輯器匯出的 Excel', () => {
  it('標示為 notEditorWorkbook 並附上實際的工作表名稱', async () => {
    // 仿造既有劇本的表格：工作表名與欄位都不是編輯器的格式。
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('CH-0-序章');
    sheet.addRow(['標誌', 'ID', '人物', '內容', '跳轉']);
    sheet.addRow(['#', '0', 'GM', '喲！', '1']);
    workbook.addWorksheet('CH-1-第二幕');

    const read = await readWorkbook(await workbook.xlsx.writeBuffer(), makeProject());

    expect(read.notEditorWorkbook).toBe(true);
    expect(read.sheetNames).toEqual(['CH-0-序章', 'CH-1-第二幕']);
    expect(read.incoming).toEqual({});
  });

  it('自家匯出的檔案不會被誤判', async () => {
    const project = makeProject();
    const { read } = await roundTrip(project);

    expect(read.notEditorWorkbook).toBe(false);
    expect(read.sheetNames).toContain('Dialogue');
  });
});

describe('唯讀欄', () => {
  it('改動唯讀欄會被記錄但不套用', async () => {
    const project = makeProject();
    const exported = await exportWorkbook(project);

    // 直接改讀回來的結果不足以測試，這裡改專案讓唯讀欄的期望值與檔案內容不符。
    project.scenes[0]!.name = '被改過的場景名';
    const read = await readWorkbook(await exported.blob.arrayBuffer(), project);

    expect(read.readonlyEdits.length).toBeGreaterThan(0);
    expect(read.readonlyEdits[0]!.column).toBe('scene');
    expect(read.incoming).toEqual(
      expect.not.objectContaining({ scene: expect.anything() }),
    );
  });
});

describe('標籤登錄表未變更時的解析一致性', () => {
  it('匯出的內容用預設 registry 解析不產生問題', async () => {
    const project = makeProject();
    const { read } = await roundTrip(project);

    const report = mergeCells({
      base: null,
      current: currentCellMap(project),
      incoming: read.incoming,
      registry: DEFAULT_TAG_REGISTRY,
    });

    expect(summarize(report).invalid).toBe(0);
  });
});
