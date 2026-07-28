import { describe, expect, it } from 'vitest';

import { currentCellMap } from '../excel/rows';
import { createChoice, createEmptyProject, createNode, createScene } from '../schema/factory';
import { cellKey } from '../schema/keys';
import { DEFAULT_TAG_REGISTRY } from '../schema/tags';
import type { StoryProject } from '../schema/story';
import { applyCells } from './apply';
import { defaultDecisions, mergeCells, resolveAccepted, summarize } from './merge';

const registry = DEFAULT_TAG_REGISTRY;

/** 一個雙語專案：一個節點 + 一個選項 + 一個角色。 */
function makeProject(): { project: StoryProject; nodeId: string; choiceId: string } {
  const project = createEmptyProject('合併測試', ['zh', 'en']);
  project.characters = [{ id: 'warden', name: { zh: '看守者', en: 'The Warden' } }];

  const choice = createChoice({ text: { zh: '反擊', en: 'Fight back' } });
  const node = createNode({
    text: { zh: '你來了。', en: 'You came.' },
    notes: '語氣平靜',
    speaker: 'warden',
    choices: [choice],
  });
  project.scenes = [createScene('第一幕', [node])];

  return { project, nodeId: node.id, choiceId: choice.id };
}

const textKey = (id: string, lang: string) =>
  cellKey({ ownerKind: 'node', ownerId: id }, 'text', lang);

function merge(
  base: Record<string, string> | null,
  current: Record<string, string>,
  incoming: Record<string, string>,
) {
  return mergeCells({ base, current, incoming, registry });
}

describe('三方合併規則', () => {
  it('Excel 沒動 → 跳過', () => {
    const { project, nodeId } = makeProject();
    const base = currentCellMap(project);

    const report = merge(base, base, { ...base });
    expect(summarize(report)).toMatchObject({ applied: 0, conflict: 0 });
    expect(report.changes.find((c) => c.cellKey === textKey(nodeId, 'zh'))?.status).toBe('unchanged');
  });

  it('只有 Excel 改了 → 套用', () => {
    const { project, nodeId } = makeProject();
    const base = currentCellMap(project);
    const incoming = { ...base, [textKey(nodeId, 'en')]: 'You have arrived.' };

    const report = merge(base, base, incoming);
    expect(summarize(report).applied).toBe(1);
    expect(report.changes.find((c) => c.status === 'applied')?.cellKey).toBe(textKey(nodeId, 'en'));
  });

  it('只有編輯器改了 → 不被 Excel 的舊值覆蓋', () => {
    const { project } = makeProject();
    const base = currentCellMap(project);
    project.scenes[0]!.nodes[0]!.text.zh = '你終於來了。';
    const current = currentCellMap(project);

    const report = merge(base, current, base);
    expect(summarize(report)).toMatchObject({ applied: 0, conflict: 0 });
  });

  it('兩邊都改了同一格 → 衝突', () => {
    const { project, nodeId } = makeProject();
    const base = currentCellMap(project);
    project.scenes[0]!.nodes[0]!.text.zh = '你終於來了。';
    const current = currentCellMap(project);
    const incoming = { ...base, [textKey(nodeId, 'zh')]: '你竟然來了。' };

    const report = merge(base, current, incoming);
    expect(summarize(report).conflict).toBe(1);
    expect(report.changes.find((c) => c.status === 'conflict')?.cellKey).toBe(textKey(nodeId, 'zh'));
  });

  it('兩邊改成一樣 → 不算衝突', () => {
    const { project, nodeId } = makeProject();
    const base = currentCellMap(project);
    project.scenes[0]!.nodes[0]!.text.zh = '你終於來了。';
    const current = currentCellMap(project);
    const incoming = { ...base, [textKey(nodeId, 'zh')]: '你終於來了。' };

    expect(summarize(merge(base, current, incoming))).toMatchObject({ applied: 0, conflict: 0 });
  });

  it('計畫的核心情境：編輯器改中文、Excel 改英文 → 兩者都套用，不衝突', () => {
    const { project, nodeId } = makeProject();
    const base = currentCellMap(project);

    project.scenes[0]!.nodes[0]!.text.zh = '你終於來了。';
    const current = currentCellMap(project);
    const incoming = { ...base, [textKey(nodeId, 'en')]: 'You have arrived.' };

    const report = merge(base, current, incoming);
    expect(summarize(report)).toMatchObject({ applied: 1, conflict: 0 });

    applyCells(project, resolveAccepted(report, defaultDecisions(report)));
    expect(project.scenes[0]!.nodes[0]!.text).toEqual({
      zh: '你終於來了。',
      en: 'You have arrived.',
    });
  });

  it('沒有快照時全部視為衝突，不預設覆蓋', () => {
    const { project, nodeId } = makeProject();
    const current = currentCellMap(project);
    const incoming = { ...current, [textKey(nodeId, 'zh')]: '被別人改過的版本' };

    const report = merge(null, current, incoming);
    expect(report.noSnapshot).toBe(true);
    expect(summarize(report)).toMatchObject({ applied: 0, conflict: 1 });
    expect(resolveAccepted(report, defaultDecisions(report))).toEqual({});
  });
});

describe('標記完整性', () => {
  it('翻譯者弄壞標籤 → 標為 invalid，不套用', () => {
    const { project, nodeId } = makeProject();
    project.scenes[0]!.nodes[0]!.text.en = 'You [shake]came[/shake].';
    const base = currentCellMap(project);
    const incoming = { ...base, [textKey(nodeId, 'en')]: 'You [shake]came.' };

    const report = merge(base, base, incoming);
    const change = report.changes.find((c) => c.cellKey === textKey(nodeId, 'en'));
    expect(change?.status).toBe('invalid');
    expect(change?.issues[0]).toContain('沒有結束標籤');
    expect(resolveAccepted(report, defaultDecisions(report))).toEqual({});
  });

  it('使用者仍可手動選擇接受 invalid 的內容', () => {
    const { project, nodeId } = makeProject();
    const base = currentCellMap(project);
    const key = textKey(nodeId, 'en');
    const report = merge(base, base, { ...base, [key]: 'You [shake]came.' });

    expect(resolveAccepted(report, { ...defaultDecisions(report), [key]: true })).toEqual({
      [key]: 'You [shake]came.',
    });
  });
});

describe('列層級的差異', () => {
  it('Excel 多出的列列為未知，不自動新增', () => {
    const { project } = makeProject();
    const current = currentCellMap(project);
    const strayKey = cellKey({ ownerKind: 'node', ownerId: '01KYJCW9TQKZDPGVV5H86A0QF2' }, 'text', 'zh');

    const report = merge(current, current, { ...current, [strayKey]: '哪來的台詞' });
    expect(report.unknownRows).toEqual(['node:01KYJCW9TQKZDPGVV5H86A0QF2']);
    expect(report.changes.some((c) => c.cellKey === strayKey)).toBe(false);
  });

  it('Excel 缺少的列列為缺列，不自動刪除', () => {
    const { project, choiceId } = makeProject();
    const current = currentCellMap(project);
    const incoming = Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith(`choice:${choiceId}`)),
    );

    const report = merge(current, current, incoming);
    expect(report.missingRows).toEqual([`choice:${choiceId}`]);
    expect(project.scenes[0]!.nodes[0]!.choices).toHaveLength(1);
  });
});

describe('applyCells', () => {
  it('寫回節點台詞、備註、選項與角色名', () => {
    const { project, nodeId, choiceId } = makeProject();

    const result = applyCells(project, {
      [cellKey({ ownerKind: 'node', ownerId: nodeId }, 'text', 'en')]: 'You have arrived.',
      [cellKey({ ownerKind: 'node', ownerId: nodeId }, 'notes', null)]: '改過的備註',
      [cellKey({ ownerKind: 'choice', ownerId: choiceId }, 'text', 'en')]: 'Strike back',
      [cellKey({ ownerKind: 'character', ownerId: 'warden' }, 'name', 'en')]: 'Warden',
    });

    expect(result).toEqual({ applied: 4, skipped: 0 });
    const node = project.scenes[0]!.nodes[0]!;
    expect(node.text.en).toBe('You have arrived.');
    expect(node.notes).toBe('改過的備註');
    expect(node.choices[0]!.text.en).toBe('Strike back');
    expect(project.characters[0]!.name.en).toBe('Warden');
  });

  it('找不到對應實體時跳過，不新增也不拋錯', () => {
    const { project } = makeProject();
    const before = structuredClone(project);

    const result = applyCells(project, {
      [cellKey({ ownerKind: 'node', ownerId: '01KYJCW9TQKZDPGVV5H86A0QF2' }, 'text', 'zh')]: 'x',
      'garbage-key': 'y',
    });

    expect(result).toEqual({ applied: 0, skipped: 2 });
    expect(project).toEqual(before);
  });
});
