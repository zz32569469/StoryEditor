import type { NodeKind, StoryNode } from '../schema/story';

/** 節點種類的顯示文字，UI 各處共用。 */
export const KIND_LABEL: Record<NodeKind, string> = {
  line: '台詞',
  branch: '條件分支',
  set: '賦值',
  input: '玩家輸入',
  end: '結束',
};

/** 清單與預覽用的一行摘要。 */
export function summarizeNode(node: StoryNode, text: string): string {
  switch (node.kind) {
    case 'branch':
      return node.branches.map((b) => b.condition).join('  ／  ') || '（沒有分支）';
    case 'set':
    case 'input':
      return node.expression ?? '';
    case 'end':
      return '場景結束';
    case 'line':
      return text || (node.choices.length > 0 ? '（純選擇點）' : '（空白）');
  }
}
