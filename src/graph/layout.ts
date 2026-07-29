import type { GraphBlock, GraphEdge } from './build';

/**
 * 流程圖排版。
 *
 * 沒有用 dagre 這類通用的圖排版函式庫，因為劇情圖不是一般的圖 ——
 * 它九成是一條長鏈，而且**劇本本身的先後順序就是最好的排版依據**。
 * 通用演算法會為了減少交叉而重排節點，結果反而跟劇本讀起來的順序對不上。
 *
 * 這裡的規則：往下 = 劇情往後，往右 = 分岔出去的支線。
 */

/** 方塊寬度，與 CSS 的 .flow-node 一致。 */
export const NODE_WIDTH = 260;
/** 摺疊狀態的方塊高度；展開後會往下長，但排版仍以摺疊高度計算。 */
export const NODE_HEIGHT = 96;
const GAP_X = 60;
const GAP_Y = 56;

export interface Placed {
  id: string;
  x: number;
  y: number;
}

/**
 * 決定每一塊的層數。
 *
 * 只看「來源順序上比自己早」的連線 —— 回頭的跳轉（迴圈、重試、回到對話 hub）
 * 若也拿來算層數，整張圖會被拉成一團。忽略它們，回頭線就單純畫成一條往上的線。
 */
function rankBlocks(blocks: GraphBlock[], edges: GraphEdge[]): Map<string, number> {
  const orderOf = new Map(blocks.map((b) => [b.id, b.order]));
  const forwardInto = new Map<string, string[]>();
  for (const edge of edges) {
    if ((orderOf.get(edge.source) ?? 0) >= (orderOf.get(edge.target) ?? 0)) continue;
    const list = forwardInto.get(edge.target) ?? [];
    list.push(edge.source);
    forwardInto.set(edge.target, list);
  }

  // 照來源順序處理，往前的前驅必定已經算好，不需要迭代到收斂。
  const rank = new Map<string, number>();
  for (const block of [...blocks].sort((a, b) => a.order - b.order)) {
    let value = 0;
    for (const source of forwardInto.get(block.id) ?? []) {
      value = Math.max(value, (rank.get(source) ?? 0) + 1);
    }
    rank.set(block.id, value);
  }
  return rank;
}

/**
 * 決定每一塊的橫向位置。
 *
 * 每一塊優先沿用「把它拉到這一層的那個前驅」的欄位，讓主線維持在同一直行；
 * 該欄已經被佔走時才往右挪。這樣分岔出去的支線會自然落在主線右邊。
 */
function assignLanes(
  blocks: GraphBlock[],
  edges: GraphEdge[],
  rank: Map<string, number>,
): Map<string, number> {
  const orderOf = new Map(blocks.map((b) => [b.id, b.order]));
  const primary = new Map<string, string>();
  for (const edge of edges) {
    if ((orderOf.get(edge.source) ?? 0) >= (orderOf.get(edge.target) ?? 0)) continue;
    // 主前驅 = 讓它排到這一層的那一個，也就是層數最高的前驅。
    const current = primary.get(edge.target);
    if (current === undefined || (rank.get(edge.source) ?? 0) > (rank.get(current) ?? 0)) {
      primary.set(edge.target, edge.source);
    }
  }

  const lane = new Map<string, number>();
  const taken = new Map<number, Set<number>>();
  const sorted = [...blocks].sort((a, b) => {
    const byRank = (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
    return byRank !== 0 ? byRank : a.order - b.order;
  });

  for (const block of sorted) {
    const row = rank.get(block.id) ?? 0;
    const occupied = taken.get(row) ?? new Set<number>();
    const preferred = lane.get(primary.get(block.id) ?? '') ?? 0;

    let slot = preferred;
    while (occupied.has(slot)) slot += 1;

    occupied.add(slot);
    taken.set(row, occupied);
    lane.set(block.id, slot);
  }
  return lane;
}

export function layoutGraph(blocks: GraphBlock[], edges: GraphEdge[]): Placed[] {
  const rank = rankBlocks(blocks, edges);
  const lane = assignLanes(blocks, edges, rank);

  return blocks.map((block) => ({
    id: block.id,
    x: (lane.get(block.id) ?? 0) * (NODE_WIDTH + GAP_X),
    y: (rank.get(block.id) ?? 0) * (NODE_HEIGHT + GAP_Y),
  }));
}
