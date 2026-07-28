import { describe, expect, it } from 'vitest';

import { createChoice, createEmptyProject, createNode, createScene } from '../schema/factory';
import type { StoryNode, StoryProject } from '../schema/story';
import { advance, choose, currentNode, startScene, submitInput } from './player';

/**
 * 播放器的走訪規則測試。
 *
 * 這些規則 Unity 端也要照著實作，因此每一條都要有明確的預期行為。
 */

function build(nodes: StoryNode[]): StoryProject {
  const project = createEmptyProject('播放測試', ['zh']);
  project.scenes = [createScene('第一幕', nodes)];
  return project;
}

const sceneOf = (p: StoryProject) => p.scenes[0]!.id;
const textOf = (p: StoryProject, state: ReturnType<typeof startScene>) =>
  currentNode(p, state)?.text.zh;

describe('線性推進', () => {
  it('一句接一句直到結束', () => {
    const c = createNode({ text: { zh: '第三句' } });
    const b = createNode({ text: { zh: '第二句' }, next: c.id });
    const a = createNode({ text: { zh: '第一句' }, next: b.id });
    const project = build([a, b, c]);

    let state = startScene(project, sceneOf(project));
    expect([state.status, textOf(project, state)]).toEqual(['line', '第一句']);

    state = advance(project, state);
    expect(textOf(project, state)).toBe('第二句');

    state = advance(project, state);
    expect(textOf(project, state)).toBe('第三句');

    state = advance(project, state);
    expect(state.status).toBe('ended');
  });

  it('end 節點使劇情結束', () => {
    const end = createNode({ text: {}, kind: 'end' });
    const a = createNode({ text: { zh: '最後一句' }, next: end.id });
    const project = build([a, end]);

    let state = startScene(project, sceneOf(project));
    state = advance(project, state);
    expect(state.status).toBe('ended');
  });
});

describe('選項', () => {
  it('停在選項上，選了才往下走', () => {
    const left = createNode({ text: { zh: '走左邊' } });
    const right = createNode({ text: { zh: '走右邊' } });
    const ask = createNode({
      text: { zh: '要往哪走？' },
      choices: [
        createChoice({ text: { zh: '左' }, targetNodeId: left.id }),
        createChoice({ text: { zh: '右' }, targetNodeId: right.id }),
      ],
    });
    const project = build([ask, left, right]);

    let state = startScene(project, sceneOf(project));
    expect(state.status).toBe('choices');
    // 選項狀態下 advance 沒有作用，必須明確選擇。
    expect(advance(project, state)).toBe(state);

    state = choose(project, state, ask.choices[1]!.id);
    expect(textOf(project, state)).toBe('走右邊');
  });

  it('選項目標為 null 代表結束', () => {
    const ask = createNode({
      text: { zh: '結束嗎？' },
      choices: [createChoice({ text: { zh: '嗯' }, targetNodeId: null })],
    });
    const project = build([ask]);

    const state = choose(project, startScene(project, sceneOf(project)), ask.choices[0]!.id);
    expect(state.status).toBe('ended');
  });
});

describe('賦值與條件分支', () => {
  /** 模擬來源劇本的形狀：set 設定變數，branch 依變數選路。 */
  function branchingProject() {
    const young = createNode({ text: { zh: '你還年輕。' } });
    const old = createNode({ text: { zh: '你已經成年了。' } });
    const branch = createNode({
      text: {},
      kind: 'branch',
      branches: [
        { id: '01KYJCW9TK5KTA2ZM25PGHS8AA', condition: 'age < 25', targetNodeId: young.id, extras: {} },
        { id: '01KYJCW9TNZVMPJSWTW342D9DC', condition: 'age >= 25', targetNodeId: old.id, extras: {} },
      ],
    });
    const set = createNode({ text: {}, kind: 'set', expression: 'age = Max(rawAge, 0)', next: branch.id });
    const start = createNode({ text: { zh: '開始。' }, next: set.id });
    return { project: build([start, set, branch, young, old]), start };
  }

  it('set 與 branch 不需要玩家介入，會連續處理完', () => {
    const { project } = branchingProject();

    let state = startScene(project, sceneOf(project), { initialVariables: { rawAge: 30 } });
    expect(textOf(project, state)).toBe('開始。');

    state = advance(project, state);
    // set 與 branch 都在這一次推進中處理完，直接停在台詞上。
    expect(state.status).toBe('line');
    expect(textOf(project, state)).toBe('你已經成年了。');
    expect(state.variables.get('age')).toBe(30);
  });

  it('分支依條件順序取第一個成立的', () => {
    const { project } = branchingProject();
    const state = advance(project, startScene(project, sceneOf(project), { initialVariables: { rawAge: 18 } }));
    expect(textOf(project, state)).toBe('你還年輕。');
  });

  it('專案宣告的變數預設值會被套用', () => {
    const { project } = branchingProject();
    project.variables = [{ id: 'rawAge', type: 'number', default: 40, description: '' }];

    const state = advance(project, startScene(project, sceneOf(project)));
    expect(textOf(project, state)).toBe('你已經成年了。');
  });

  it('沒有任何條件成立時報錯而不是靜默卡住', () => {
    const { project } = branchingProject();
    const branch = project.scenes[0]!.nodes.find((n) => n.kind === 'branch')!;
    branch.branches.forEach((b) => (b.condition = 'age > 999'));

    const state = advance(project, startScene(project, sceneOf(project), { initialVariables: { rawAge: 30 } }));
    expect(state.status).toBe('error');
    expect(state.error).toContain('沒有任何條件成立');
  });

  it('變數沒有值時報錯，並指出是哪一條運算式', () => {
    const { project } = branchingProject();
    const state = advance(project, startScene(project, sceneOf(project)));

    expect(state.status).toBe('error');
    expect(state.error).toContain('rawAge');
  });
});

describe('玩家輸入', () => {
  it('停在輸入節點，填完後繼續', () => {
    const after = createNode({ text: { zh: '你好。' } });
    const input = createNode({ text: {}, kind: 'input', expression: 'lastName, firstName', next: after.id });
    const project = build([input, after]);

    let state = startScene(project, sceneOf(project));
    expect(state.status).toBe('input');
    expect(state.pendingInputs).toEqual(['lastName', 'firstName']);

    state = submitInput(project, state, { lastName: '柚', firstName: '葉' });
    expect(state.status).toBe('line');
    expect(state.variables.get('lastName')).toBe('柚');
  });

  it('沒有宣告時，數字外觀的輸入轉成數字，否則比較會失敗', () => {
    const input = createNode({ text: {}, kind: 'input', expression: 'age', next: null });
    const project = build([input]);

    const state = submitInput(project, startScene(project, sceneOf(project)), { age: '30' });
    expect(state.variables.get('age')).toBe(30);
  });

  it('宣告為日期的變數維持字串，不會被轉成數字', () => {
    const input = createNode({ text: {}, kind: 'input', expression: 'birthday', next: null });
    const project = build([input]);
    project.variables = [{ id: 'birthday', type: 'date', default: '', description: '' }];

    const state = submitInput(project, startScene(project, sceneOf(project)), {
      birthday: '2026-01-01',
    });
    // 轉成數字的話 CalcAge 會拿到無效值，分支就全走錯。
    expect(state.variables.get('birthday')).toBe('2026-01-01');
  });

  it('宣告型別優先於外觀猜測', () => {
    const input = createNode({ text: {}, kind: 'input', expression: 'code', next: null });
    const project = build([input]);
    project.variables = [{ id: 'code', type: 'string', default: '', description: '' }];

    // 郵遞區號這種「看起來像數字的文字」不該被轉成數字。
    const state = submitInput(project, startScene(project, sceneOf(project)), { code: '00812' });
    expect(state.variables.get('code')).toBe('00812');
  });
});

describe('防護', () => {
  it('偵測無限迴圈而不是當掉', () => {
    const a = createNode({ text: {}, kind: 'set', expression: 'n = 1' });
    a.next = a.id;
    const project = build([a]);

    const state = startScene(project, sceneOf(project));
    expect(state.status).toBe('error');
    expect(state.error).toContain('無限迴圈');
  });

  it('跳轉指向不存在的節點時報錯', () => {
    const a = createNode({ text: { zh: '一' }, next: '01KYJCW9TQKZDPGVV5H86A0QF2' });
    const project = build([a]);

    const state = advance(project, startScene(project, sceneOf(project)));
    expect(state.status).toBe('error');
    expect(state.error).toContain('找不到節點');
  });

  it('遊戲特有的函式可以由呼叫端提供並覆蓋內建', () => {
    const set = createNode({ text: {}, kind: 'set', expression: 'v = CalcAge(a, b)', next: null });
    const project = build([set]);

    const state = startScene(project, sceneOf(project), {
      initialVariables: { a: 1, b: 2 },
      functions: {
        CalcAge: { arity: 2, returns: 'number', params: ['string', 'string'], description: '測試用', call: () => 99 },
      },
    });
    expect(state.variables.get('v')).toBe(99);
  });
});
