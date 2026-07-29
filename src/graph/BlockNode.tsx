import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';

import type { BlockKind, GraphBlock } from './build';

/**
 * 流程圖上的一個方塊。
 *
 * 摺疊時只露出第一句，展開後列出塊內每一句 —— 每一句都可以點，
 * 點了右邊的編輯面板就跳到那一句。圖是導覽工具，不是另一個編輯器。
 */

export interface BlockNodeData extends Record<string, unknown> {
  block: GraphBlock;
  /** 目前在右側編輯的那一句是不是在這一塊裡。 */
  activeNodeId: string | null;
  expanded: boolean;
  onToggle: (blockId: string) => void;
  onSelect: (nodeId: string) => void;
}

const KIND_LABEL: Record<BlockKind, string> = {
  line: '台詞',
  choices: '選項',
  branch: '條件分支',
  set: '賦值',
  input: '玩家輸入',
  end: '結束',
};

export function BlockNode({ data }: NodeProps<Node<BlockNodeData>>) {
  const { block, activeNodeId, expanded, onToggle, onSelect } = data;
  const active = activeNodeId !== null && block.nodeIds.includes(activeNodeId);
  const head = block.lines[0]!;
  const hidden = block.lines.length - 1;

  return (
    <div
      className={[
        'flow-node',
        `flow-node--${block.kind}`,
        active ? 'is-active' : '',
        block.reachable ? '' : 'is-unreachable',
      ].join(' ')}
    >
      {/* 往下的連線用上下把手，回頭的連線用右側把手繞開，
          否則迴圈會直接穿過中間的方塊。 */}
      <Handle type="target" position={Position.Top} id="in" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="out" isConnectable={false} />
      <Handle
        type="source"
        position={Position.Right}
        id="out-back"
        style={{ top: '70%' }}
        isConnectable={false}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="in-back"
        style={{ top: '30%' }}
        isConnectable={false}
      />

      <header className="flow-node-head">
        <span className="flow-kind">{KIND_LABEL[block.kind]}</span>
        {block.lines.length > 1 && <span className="flow-count">{block.lines.length} 句</span>}

        <span className="flow-flags">
          {block.jumpIn > 1 && <b title={`${block.jumpIn} 處流進這裡`}>⇄{block.jumpIn}</b>}
          {!block.reachable && <b className="is-warn" title="從場景起點走不到這裡">走不到</b>}
          {block.broken > 0 && (
            <b className="is-error" title={`${block.broken} 個跳轉指向不存在的節點`}>斷</b>
          )}
        </span>
      </header>

      {expanded ? (
        <ol className="flow-lines">
          {block.lines.map((line) => (
            <li key={line.nodeId}>
              <button
                type="button"
                className={`nodrag ${line.nodeId === activeNodeId ? 'is-active' : ''}`}
                onClick={() => onSelect(line.nodeId)}
              >
                {line.speaker && <em>{line.speaker}：</em>}
                {line.summary}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <button type="button" className="flow-summary nodrag" onClick={() => onSelect(head.nodeId)}>
          {head.speaker && <em>{head.speaker}：</em>}
          {head.summary}
        </button>
      )}

      {hidden > 0 && (
        <button
          type="button"
          className="flow-more nodrag"
          onClick={() => onToggle(block.id)}
          title={expanded ? '收合' : '展開這一段的每一句'}
        >
          {expanded ? '收合' : `＋ 還有 ${hidden} 句`}
        </button>
      )}

      {block.terminal && <footer className="flow-terminal">劇情到此結束</footer>}
    </div>
  );
}
