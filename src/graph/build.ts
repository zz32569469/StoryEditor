import type { NodeKind, Scene, StoryNode, StoryProject } from '../schema/story';
import { stripTags } from '../tags/parse';

/**
 * 把場景的節點串成一張流程圖。
 *
 * 一句台詞一個方塊是行不通的 —— 實際劇本一個場景就有好幾百句，畫出來只是一條
 * 看不完的長條。因此**連續的線性台詞會摺成一塊**，只有真正影響流程的地方
 * （選項、條件分支、賦值、輸入、以及被別處跳進來的 hub）才單獨成塊。
 *
 * 這裡是純函式，不碰 React —— 分塊與連線規則必須能單獨測試，
 * 否則圖畫錯了會被誤認成劇本寫錯。
 */

/** 方塊的性質，取自塊內最後一個節點 —— 決定它怎麼往下走。 */
export type BlockKind = 'line' | 'choices' | 'branch' | 'set' | 'input' | 'end';

export interface BlockLine {
  nodeId: string;
  kind: NodeKind;
  /** 已解析成顯示名的說話者，旁白為空字串。 */
  speaker: string;
  /** 去掉特效標記後的一行摘要。 */
  summary: string;
}

export interface GraphBlock {
  /** 等於塊內第一個節點的 id —— 所有跳轉的目標都保證是某一塊的頭。 */
  id: string;
  nodeIds: string[];
  kind: BlockKind;
  lines: BlockLine[];
  /**
   * 有幾條線指進這一塊，也就是圖上實際畫出來的箭頭數。
   *
   * 摺進同一塊的順序流入不算 —— 那沒有箭頭。大於 1 就是對話 hub。
   */
  jumpIn: number;
  /** 從場景起點走得到嗎。 */
  reachable: boolean;
  /** 這一塊往外指、但目標不存在的跳轉數。 */
  broken: number;
  /** 沒有任何出口 —— 劇情走到這裡就停了。 */
  terminal: boolean;
  /** 在來源順序中的位置，排版時用來維持劇本原本的先後。 */
  order: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: 'next' | 'choice' | 'branch';
  label: string;
  /** 目標在來源順序上比自己早 —— 回頭的跳轉，畫法要不一樣。 */
  back: boolean;
}

export interface SceneGraph {
  blocks: GraphBlock[];
  edges: GraphEdge[];
  /** nodeId → 它所屬方塊的 id，供「選取節點時高亮對應方塊」使用。 */
  blockOfNode: Map<string, string>;
}

/** 摘要最多留幾個字，超過就截斷 —— 方塊寬度固定，塞不下整句。 */
const SUMMARY_LIMIT = 42;
/** 連線標籤比方塊窄得多，要截得更短。 */
const LABEL_LIMIT = 18;

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function textOf(record: Record<string, string>, lang: string, base: string): string {
  return record[lang] ?? record[base] ?? '';
}

/**
 * 節點往下走的目標。
 *
 * 刻意照 runtime/player.ts 的規則寫死，兩邊不可以分歧 ——
 * 圖上畫得出來、實際卻走不到（或反之）比沒有圖更糟。
 */
function outgoing(node: StoryNode): { target: string | null; kind: GraphEdge['kind']; label: string }[] {
  switch (node.kind) {
    case 'end':
      // end 節點就是終點，player 在這裡回報 ended，不會再看 next。
      return [];
    case 'branch':
      // 沒有 fallback —— player 在所有條件都不成立時是直接報錯，不是走 next。
      // 這裡若補一條「否則」的線就等於騙人。
      return node.branches.map((b) => ({
        target: b.targetNodeId,
        kind: 'branch' as const,
        label: b.condition,
      }));
    case 'line':
      if (node.choices.length > 0) {
        // 有選項時 player 完全忽略 next。
        return node.choices.map((c) => ({ target: c.targetNodeId, kind: 'choice' as const, label: '' }));
      }
      return [{ target: node.next, kind: 'next' as const, label: '' }];
    case 'set':
    case 'input':
      return [{ target: node.next, kind: 'next' as const, label: '' }];
  }
}

function blockKindOf(node: StoryNode): BlockKind {
  if (node.kind === 'line') return node.choices.length > 0 ? 'choices' : 'line';
  return node.kind;
}

/**
 * 前一個節點能不能把這個節點併進同一塊。
 *
 * 三個條件缺一不可，少看任何一邊都會摺錯：
 * - 前一個必須是**還沒收尾**的台詞（有選項的台詞是塊尾，分支／賦值自成一塊）
 * - 這一個必須是台詞 —— 賦值、輸入、結束這些會改變流程或狀態，
 *   摺進台詞裡就等於在圖上把它們藏起來
 * - 兩者確實相接
 */
function absorbs(previous: StoryNode | undefined, node: StoryNode): boolean {
  if (!previous) return false;
  if (previous.kind !== 'line' || previous.choices.length > 0) return false;
  if (node.kind !== 'line') return false;
  return previous.next === node.id;
}

export function buildSceneGraph(project: StoryProject, scene: Scene, lang: string): SceneGraph {
  const base = project.meta.baseLanguage;
  const nodeById = new Map(scene.nodes.map((n) => [n.id, n]));
  const indexById = new Map(scene.nodes.map((n, i) => [n.id, i]));

  const speakerName = (node: StoryNode): string => {
    if (!node.speaker) return '';
    const character = project.characters.find((c) => c.id === node.speaker);
    if (!character) return node.speaker;
    return textOf(character.name, lang, base) || character.id;
  };

  const summaryOf = (node: StoryNode): string => {
    switch (node.kind) {
      case 'branch':
        return node.branches.map((b) => b.condition).join(' ／ ') || '（沒有分支）';
      case 'set':
      case 'input':
        return node.expression ?? '';
      case 'end':
        return '場景結束';
      case 'line': {
        const text = stripTags(textOf(node.text, lang, base), project.tagRegistry);
        if (text) return text;
        return node.choices.length > 0 ? '（純選擇點）' : '（空白）';
      }
    }
  };

  // ---- 1. 找出所有「塊頭」------------------------------------------------
  // 被別處跳進來的節點一定要是塊頭，否則跳轉會指到某一塊的中間，
  // 連線就沒有可以接的地方。
  const heads = new Set<string>();
  if (scene.entryNodeId) heads.add(scene.entryNodeId);
  scene.nodes.forEach((node, i) => {
    if (!absorbs(scene.nodes[i - 1], node)) heads.add(node.id);
  });
  for (const node of scene.nodes) {
    for (const { target } of outgoing(node)) {
      if (target === null) continue;
      const targetNode = nodeById.get(target);
      // 指向不存在的節點，稍後在連線階段標記，這裡略過以免影響分塊。
      if (!targetNode) continue;
      // 「接著往下讀」不是跳轉，不該把後面那句切開來。
      const sequential =
        indexById.get(target) === indexById.get(node.id)! + 1 && absorbs(node, targetNode);
      if (!sequential) heads.add(target);
    }
  }

  // ---- 2. 依塊頭切段 ------------------------------------------------------
  // 非塊頭的節點必定是由陣列前一個順序流入的（見上面的判斷），
  // 所以照順序切段就是正確的分塊。
  const blocks: GraphBlock[] = [];
  const blockOfNode = new Map<string, string>();
  for (const node of scene.nodes) {
    const line: BlockLine = {
      nodeId: node.id,
      kind: node.kind,
      speaker: speakerName(node),
      summary: truncate(summaryOf(node), SUMMARY_LIMIT),
    };

    if (heads.has(node.id) || blocks.length === 0) {
      blocks.push({
        id: node.id,
        nodeIds: [node.id],
        kind: blockKindOf(node),
        lines: [line],
        jumpIn: 0,
        reachable: false,
        broken: 0,
        terminal: false,
        order: blocks.length,
      });
    } else {
      const block = blocks[blocks.length - 1]!;
      block.nodeIds.push(node.id);
      block.lines.push(line);
      block.kind = blockKindOf(node);
    }
    blockOfNode.set(node.id, blocks[blocks.length - 1]!.id);
  }

  // ---- 3. 連線 -----------------------------------------------------------
  // 只看每一塊的最後一個節點：塊內其他節點依定義都是線性往下，沒有分歧。
  const edges: GraphEdge[] = [];
  for (const block of blocks) {
    const last = nodeById.get(block.nodeIds[block.nodeIds.length - 1]!)!;
    const exits = outgoing(last);

    exits.forEach((exit, i) => {
      if (exit.target === null) return;
      const targetBlock = blockOfNode.get(exit.target);
      if (!targetBlock) {
        // 指向不存在的節點。參照檢查會另外報，這裡只在圖上標出來。
        block.broken += 1;
        return;
      }

      const label =
        exit.kind === 'choice'
          ? truncate(
              stripTags(textOf(last.choices[i]!.text, lang, base), project.tagRegistry),
              LABEL_LIMIT,
            )
          : truncate(exit.label, LABEL_LIMIT);

      edges.push({
        id: `${block.id}:${i}`,
        source: block.id,
        target: targetBlock,
        kind: exit.kind,
        label,
        back: (indexById.get(exit.target) ?? 0) <= (indexById.get(block.id) ?? 0),
      });
    });

    // 「劇情在這裡結束」與「跳轉指到不存在的節點」是兩回事，要分開標：
    // 前者多半是刻意的，後者一定是壞掉。
    block.terminal = exits.every((exit) => exit.target === null);
  }

  // ---- 4. 從起點做可達性 --------------------------------------------------
  // 走不到的段落是資料出錯最常見的樣子（改跳轉時漏接一段），
  // 圖最大的價值之一就是讓它一眼看得見。
  const outByBlock = new Map<string, string[]>();
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const edge of edges) {
    const list = outByBlock.get(edge.source) ?? [];
    list.push(edge.target);
    outByBlock.set(edge.source, list);
    // 流入數直接數實際的線，而不是靠分塊時的判斷推 ——
    // 徽章上寫的數字必須跟畫面上看得到的箭頭一致。
    byId.get(edge.target)!.jumpIn += 1;
  }
  const entryBlock = scene.entryNodeId ? blockOfNode.get(scene.entryNodeId) : blocks[0]?.id;
  const queue = entryBlock ? [entryBlock] : [];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const block = byId.get(id);
    if (block) block.reachable = true;
    for (const next of outByBlock.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return { blocks, edges, blockOfNode };
}
