import { describe, expect, it } from 'vitest';

import { createEmptyProject } from '../schema/factory';
import type { Scene, StoryNode, StoryProject } from '../schema/story';
import { buildSceneGraph } from './build';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';

/**
 * 測試用的節點。id 直接用可讀字串 —— 這裡不經過 schema 驗證，
 * 而看得懂的 id 讓斷言失敗時能立刻知道是哪一塊出錯。
 */
function node(id: string, patch: Partial<StoryNode> = {}): StoryNode {
  return {
    id,
    kind: 'line',
    text: { zh: id },
    choices: [],
    next: null,
    actions: [],
    notes: '',
    branches: [],
    extras: {},
    ...patch,
  };
}

/** 一串線性台詞：a → b → c，最後一個 next 為 null。 */
function chain(...ids: string[]): StoryNode[] {
  return ids.map((id, i) => node(id, { next: ids[i + 1] ?? null }));
}

function sceneOf(nodes: StoryNode[]): Scene {
  return { id: 'scene', name: '測試', entryNodeId: nodes[0]?.id ?? null, nodes };
}

function projectOf(): StoryProject {
  return createEmptyProject('測試', ['zh']);
}

function build(nodes: StoryNode[]) {
  return buildSceneGraph(projectOf(), sceneOf(nodes), 'zh');
}

describe('分塊', () => {
  it('連續的線性台詞摺成一塊', () => {
    const { blocks, edges } = build(chain('a', 'b', 'c', 'd', 'e'));

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.nodeIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(blocks[0]!.terminal).toBe(true);
    expect(edges).toHaveLength(0);
  });

  it('被跳進來的節點會另起一塊，否則跳轉沒地方可接', () => {
    const nodes = chain('a', 'b', 'c', 'd');
    // a 直接跳到 c，於是 c 成為 hub。
    nodes[0]!.next = 'c';

    const { blocks } = build(nodes);
    const ids = blocks.map((b) => b.nodeIds);

    expect(ids).toEqual([['a'], ['b'], ['c', 'd']]);
    // a 跳進來，b 也接著流進來 —— 圖上是兩支箭頭，徽章就該寫 2。
    expect(blocks.find((b) => b.id === 'c')!.jumpIn).toBe(2);
  });

  it('順序往下讀不算跳進來，不會被誤判成 hub', () => {
    const { blocks } = build(chain('a', 'b', 'c'));
    expect(blocks[0]!.jumpIn).toBe(0);
  });

  it('多處跳進同一個節點會累計 —— 對話 hub 就是這樣', () => {
    const nodes = [
      node('a', { next: 'hub' }),
      node('b', { next: 'hub' }),
      node('hub', { next: null }),
    ];
    const { blocks } = build(nodes);
    expect(blocks.find((b) => b.id === 'hub')!.jumpIn).toBe(2);
  });

  it('賦值與輸入各自成塊 —— 它們改變數，摺進台詞裡就看不見了', () => {
    const nodes = [
      ...chain('a', 'b'),
      node('s', { kind: 'set', expression: 'gold = 10', next: 'c' }),
      node('c', { next: null }),
    ];
    nodes[1]!.next = 's';

    const { blocks } = build(nodes);
    expect(blocks.map((b) => b.nodeIds)).toEqual([['a', 'b'], ['s'], ['c']]);
    expect(blocks[1]!.kind).toBe('set');
  });
});

describe('連線', () => {
  it('選項各自一條線，標籤是選項文字', () => {
    const nodes = [
      node('q', {
        choices: [
          { id: 'c1', text: { zh: '往左' }, targetNodeId: 'left', extras: {} },
          { id: 'c2', text: { zh: '往右' }, targetNodeId: 'right', extras: {} },
        ],
      }),
      node('left'),
      node('right'),
    ];

    const { edges } = build(nodes);
    expect(edges).toHaveLength(2);
    expect(edges.map((e) => [e.target, e.label])).toEqual([
      ['left', '往左'],
      ['right', '往右'],
    ]);
    expect(edges.every((e) => e.kind === 'choice')).toBe(true);
  });

  it('有選項時忽略 next —— 與 player 的規則一致', () => {
    const nodes = [
      node('q', {
        next: 'ignored',
        choices: [{ id: 'c1', text: { zh: '好' }, targetNodeId: 'left', extras: {} }],
      }),
      node('left'),
      node('ignored'),
    ];

    const { edges } = build(nodes);
    expect(edges.map((e) => e.target)).toEqual(['left']);
  });

  it('條件分支不畫「否則」的線 —— player 在全部不成立時是報錯，不是走 next', () => {
    const nodes = [
      node('if', {
        kind: 'branch',
        next: 'fallthrough',
        branches: [
          { id: 'b1', condition: 'gold > 10', targetNodeId: 'rich', extras: {} },
          { id: 'b2', condition: 'true', targetNodeId: 'poor', extras: {} },
        ],
      }),
      node('rich'),
      node('poor'),
      node('fallthrough'),
    ];

    const { edges } = build(nodes);
    expect(edges.map((e) => e.target)).toEqual(['rich', 'poor']);
    expect(edges.map((e) => e.label)).toEqual(['gold > 10', 'true']);
  });

  it('回頭的跳轉會被標記，排版才知道要另外畫', () => {
    const nodes = chain('a', 'b', 'c');
    nodes[2]!.next = 'a';

    const { edges } = build(nodes);
    const back = edges.find((e) => e.target === 'a');
    expect(back?.back).toBe(true);
  });

  it('指向不存在的節點算「斷掉」，不會生出一條連到空氣的線', () => {
    const { blocks, edges } = build([node('a', { next: 'nowhere' })]);

    expect(edges).toHaveLength(0);
    expect(blocks[0]!.broken).toBe(1);
    // 它有出口、只是壞掉，跟「劇情到此為止」不一樣。
    expect(blocks[0]!.terminal).toBe(false);
  });
});

describe('可達性', () => {
  it('走不到的段落會被標出來', () => {
    const nodes = [
      node('a', { next: null }),
      // b 沒有任何人指過來。
      ...chain('b', 'c'),
    ];

    const { blocks } = build(nodes);
    expect(blocks.find((b) => b.id === 'a')!.reachable).toBe(true);
    expect(blocks.find((b) => b.id === 'b')!.reachable).toBe(false);
  });

  it('經由選項才到得了的段落算走得到', () => {
    const nodes = [
      node('q', { choices: [{ id: 'c1', text: { zh: '去' }, targetNodeId: 'far', extras: {} }] }),
      node('mid'),
      node('far'),
    ];

    const { blocks } = build(nodes);
    expect(blocks.find((b) => b.id === 'far')!.reachable).toBe(true);
    expect(blocks.find((b) => b.id === 'mid')!.reachable).toBe(false);
  });
});

describe('排版', () => {
  it('線性劇情排成一直行，順序就是劇本順序', () => {
    const nodes = [
      node('a', { next: 's' }),
      node('s', { kind: 'set', expression: 'x = 1', next: 'b' }),
      node('b'),
    ];

    const { blocks, edges } = build(nodes);
    const placed = layoutGraph(blocks, edges);
    const at = (id: string) => placed.find((p) => p.id === id)!;

    expect(at('a').x).toBe(at('s').x);
    expect(at('s').x).toBe(at('b').x);
    expect(at('s').y).toBeGreaterThan(at('a').y);
    expect(at('b').y).toBeGreaterThan(at('s').y);
  });

  it('分岔出去的支線落在右邊，不會疊在一起', () => {
    const nodes = [
      node('q', {
        choices: [
          { id: 'c1', text: { zh: '左' }, targetNodeId: 'left', extras: {} },
          { id: 'c2', text: { zh: '右' }, targetNodeId: 'right', extras: {} },
        ],
      }),
      node('left'),
      node('right'),
    ];

    const { blocks, edges } = build(nodes);
    const placed = layoutGraph(blocks, edges);
    const at = (id: string) => placed.find((p) => p.id === id)!;

    expect(at('left').y).toBe(at('right').y);
    expect(Math.abs(at('left').x - at('right').x)).toBeGreaterThanOrEqual(NODE_WIDTH);
  });

  it('回頭的跳轉不影響層數 —— 否則整張圖會被迴圈拉成一團', () => {
    const nodes = [
      node('a', { next: 's' }),
      node('s', { kind: 'set', expression: 'x = 1', next: 'c' }),
      node('c', { next: 'a' }),
    ];

    const { blocks, edges } = build(nodes);
    const placed = layoutGraph(blocks, edges);
    // 三塊仍是一直行往下，a 還在最上面，沒有被 c 的回頭線拉下去。
    expect(placed.find((p) => p.id === 'a')!.y).toBe(0);
    expect(placed.find((p) => p.id === 'c')!.y).toBe(2 * (NODE_HEIGHT + 56));
  });

  it('往前跳很遠時，長鏈仍決定層數，不會把後面的段落拉上來', () => {
    const nodes = chain('a', 'b', 'c', 'd');
    // a 同時也直接跳到 d。
    nodes[0]!.choices = [
      { id: 'c1', text: { zh: '接著讀' }, targetNodeId: 'b', extras: {} },
      { id: 'c2', text: { zh: '跳過' }, targetNodeId: 'd', extras: {} },
    ];
    nodes[0]!.next = null;

    const { blocks, edges } = build(nodes);
    const placed = layoutGraph(blocks, edges);
    const at = (id: string) => placed.find((p) => p.id === id)!;

    // b 與 c 摺成一塊；d 要排在它下面，而不是被 a 的捷徑拉到第二層。
    expect(at('d').y).toBeGreaterThan(at('b').y);
  });
});
