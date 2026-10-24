import { describe, expect, it } from 'vitest';

import { createEmptyProject, createNode, createScene } from '../schema/factory';
import { validateStoryProject } from '../schema/validate';
import { parseStage } from './directives';

describe('演出欄位解析', () => {
  it('背景與插圖：代號；「無」代表清除', () => {
    expect(parseStage({ background: '店內-白天', cg: '無' })).toMatchObject({
      background: { key: '店內-白天' },
      cg: { key: null },
      issues: [],
    });
  });

  it('畫面效果：別名、預設值補齊、多個指令依序', () => {
    const parsed = parseStage({ screenEffect: '睜眼效果，震動 0.2，閃白 0.1，黑幕' });
    expect(parsed.screen).toEqual([
      { name: '睜眼', args: [1.2] },
      { name: '震動', args: [0.2, 1] },
      { name: '閃白', args: [0.1] },
      { name: '黑幕', args: [] },
    ]);
    expect(parsed.issues).toEqual([]);
  });

  it('舊寫法 OpenNameInput 轉成 input 指令，照收不報錯', () => {
    expect(parseStage({ screenEffect: 'OpenNameInput' }).screen).toEqual([
      { name: 'input', args: [], key: 'Name' },
    ]);
  });

  it('不認得的指令、參數太多、參數不是數字都列為問題，其餘照常解析', () => {
    const parsed = parseStage({ screenEffect: '轉圈 1，淡入 1 2，震動 快，淡出 0.4' });
    expect(parsed.screen).toEqual([{ name: '淡出', args: [0.4] }]);
    expect(parsed.issues).toHaveLength(3);
    expect(parsed.issues[0]).toContain('轉圈');
  });

  it('效果音與功能解鎖是代號清單；OST 有淡入秒數或停止', () => {
    expect(parseStage({ sfx: '門鈴，杯子', unlocks: '咖啡機', bgm: '早晨的店 2' })).toMatchObject({
      sfx: ['門鈴', '杯子'],
      unlocks: ['咖啡機'],
      bgm: { key: '早晨的店', fade: 2 },
    });
    expect(parseStage({ bgm: '停止' }).bgm).toEqual({ key: null, fade: 1 });
  });

  it('物品消耗：代號×數量，省略數量為 1', () => {
    expect(parseStage({ items: '咖啡豆×2，紙杯，牛奶x3' }).items).toEqual([
      { key: '咖啡豆', count: 2 },
      { key: '紙杯', count: 1 },
      { key: '牛奶', count: 3 },
    ]);
  });

  it('屬性變化：名稱±數字，負數照收', () => {
    expect(parseStage({ attributes: '信任+1，幹勁-1', target: '新人' })).toMatchObject({
      attributes: [
        { name: '信任', delta: 1 },
        { name: '幹勁', delta: -1 },
      ],
      target: '新人',
    });
  });
});

describe('舊專案檔的演出欄位', () => {
  it('開檔時從 extras 搬進 stage，extras 不再留一份', () => {
    const project = createEmptyProject('舊檔');
    project.meta.formatVersion = '1.4.0';
    const node = createNode({ text: { zh: '早安' }, extras: { 場景: '店門口', 畫面效果: '睜眼效果', 備註: '保留' } });
    project.scenes = [createScene('開幕前一天', [node])];

    const { project: loaded } = validateStoryProject(JSON.parse(JSON.stringify(project)));
    const migrated = loaded!.scenes[0]!.nodes[0]!;
    expect(migrated.stage).toEqual({ background: '店門口', screenEffect: '睜眼效果' });
    expect(migrated.extras).toEqual({ 備註: '保留' });
  });
});
