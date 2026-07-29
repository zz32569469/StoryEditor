import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';

import { useEditor, useSelectedScene } from '../state/store';
import { BlockNode, type BlockNodeData } from './BlockNode';
import { buildSceneGraph } from './build';
import { layoutGraph, NODE_HEIGHT, NODE_WIDTH } from './layout';

import '@xyflow/react/dist/base.css';
import './flow.css';

/**
 * 場景流程圖。
 *
 * 唯讀 —— 圖不改資料，只負責讓人看懂劇情怎麼分岔，以及點過去編輯。
 * 因此節點不可拖曳：拖了也不會存，留著只會讓人以為排版可以自己調。
 *
 * 用 base.css 而不是完整的 style.css：後者帶著淺色主題的預設值，
 * 會跟這個專案的深色配色打架。
 */

/** 必須定義在元件外 —— 每次 render 產生新物件會讓 React Flow 整張圖重掛。 */
const nodeTypes = { block: BlockNode };

const EDGE_COLOR = {
  next: '#5a6172',
  choice: '#6ea8fe',
  branch: '#e5c07b',
} as const;

/**
 * 開啟時的縮放。
 *
 * 刻意不用 fitView —— 實際劇本一個場景可以有四十幾層，整張攤開來縮放會掉到
 * 7% 左右，字全部糊掉，等於什麼都沒看到。與其給一張看不懂的全景，
 * 不如直接對準「使用者正在編輯的那一句」，要看全貌再按左下角的 fit。
 */
const INITIAL_ZOOM = 0.85;

export default function FlowGraph() {
  const project = useEditor((s) => s.project);
  const lang = useEditor((s) => s.lang);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const selectNode = useEditor((s) => s.selectNode);
  const scene = useSelectedScene();

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  // 換場景時全部收合，否則上一個場景展開過的塊會讓新的圖一打開就爆版。
  useEffect(() => setExpanded(new Set()), [scene?.id]);

  const onToggle = useCallback((blockId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(blockId)) next.add(blockId);
      return next;
    });
  }, []);

  /**
   * 重建整張圖是低優先權的工作。
   *
   * 打字時每一鍵都會產生新的 project，而重新分塊、重排、重建 54 個節點與
   * 73 條線要花幾十毫秒 —— 全部擠在按鍵那一幀裡，輸入就會明顯遲鈍。
   * 交給 React 延後處理：畫面先跟上打字，圖晚一拍再更新。
   * 圖是結構總覽，慢半拍完全沒有影響。
   */
  const deferredProject = useDeferredValue(project);
  const deferredScene = useDeferredValue(scene);

  const graph = useMemo(
    () => (deferredScene ? buildSceneGraph(deferredProject, deferredScene, lang) : null),
    [deferredProject, deferredScene, lang],
  );

  const positions = useMemo(
    () => (graph ? layoutGraph(graph.blocks, graph.edges) : []),
    [graph],
  );

  const activeBlockId = useMemo(
    () => (selectedNodeId ? (graph?.blockOfNode.get(selectedNodeId) ?? null) : null),
    [graph, selectedNodeId],
  );

  const flowRef = useRef<ReactFlowInstance<Node<BlockNodeData>, Edge> | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  /**
   * 最後一次**停下來**時的縮放。
   *
   * 不能在對焦時直接讀 getZoom()：setCenter 的過場動畫會先拉遠再拉近，
   * 途中被讀到就會把那個中間值當成「使用者的縮放」記下來。連續跳幾次之後
   * 整張圖就自己一路縮到下限了（實測 0.85 → 0.65 → 0.63 → 0.59…）。
   */
  const zoomRef = useRef(INITIAL_ZOOM);

  const centerOn = useCallback((blockId: string, zoom: number, duration: number) => {
    const flow = flowRef.current;
    const node = flow?.getNode(blockId);
    if (!flow || !node) return;
    flow.setCenter(node.position.x + NODE_WIDTH / 2, node.position.y + NODE_HEIGHT / 2, {
      zoom,
      duration,
    });
  }, []);

  const isVisible = useCallback((blockId: string) => {
    const flow = flowRef.current;
    const node = flow?.getNode(blockId);
    const box = canvasRef.current?.getBoundingClientRect();
    if (!flow || !node || !box) return true;

    const topLeft = flow.flowToScreenPosition(node.position);
    const bottomRight = flow.flowToScreenPosition({
      x: node.position.x + NODE_WIDTH,
      y: node.position.y + NODE_HEIGHT,
    });
    return (
      bottomRight.x > box.left &&
      topLeft.x < box.right &&
      bottomRight.y > box.top &&
      topLeft.y < box.bottom
    );
  }, []);

  /**
   * 把目標移進畫面，但**只在它已經跑出畫面時**才動。
   *
   * 每次都置中的話，使用者在圖上點一塊（本來就看得見）畫面也會跳一下，
   * 用起來像是圖在跟你搶滑鼠。
   */
  const ensureVisible = useCallback(
    (blockId: string) => {
      if (isVisible(blockId)) return;
      centerOn(blockId, Math.max(zoomRef.current, 0.5), 300);
    },
    [centerOn, isVisible],
  );

  // 在右邊選了別句時，圖跟著移過去。
  useEffect(() => {
    if (activeBlockId) ensureVisible(activeBlockId);
  }, [activeBlockId, ensureVisible]);

  /**
   * 畫布被縮小時（拖分隔線、改視窗大小）確保還看得到東西。
   *
   * React Flow 不會因為容器變小就調整視角，內容會被推到畫面外；
   * 再加上 onlyRenderVisibleElements，使用者看到的是一片全空的畫布 ——
   * 那看起來不像「捲走了」，而像壞掉了。
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      const target = activeBlockId ?? graph?.blocks[0]?.id;
      if (target) ensureVisible(target);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [activeBlockId, ensureVisible, graph]);

  const nodes = useMemo<Node<BlockNodeData>[]>(() => {
    if (!graph) return [];
    const at = new Map(positions.map((p) => [p.id, p]));
    return graph.blocks.map((block) => ({
      id: block.id,
      type: 'block',
      position: { x: at.get(block.id)?.x ?? 0, y: at.get(block.id)?.y ?? 0 },
      // 摺疊高度是排版的依據；展開後方塊自己往下長，位置不變。
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        block,
        activeNodeId: selectedNodeId,
        expanded: expanded.has(block.id),
        onToggle,
        onSelect: selectNode,
      },
    }));
  }, [graph, positions, selectedNodeId, expanded, onToggle, selectNode]);

  const edges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    return graph.edges.map((edge) => {
      const color = EDGE_COLOR[edge.kind];
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.back ? 'out-back' : 'out',
        targetHandle: edge.back ? 'in-back' : 'in',
        type: edge.back ? 'smoothstep' : 'default',
        label: edge.label || undefined,
        labelBgPadding: [4, 2] as [number, number],
        labelBgStyle: { fill: '#1c1f25' },
        labelStyle: { fill: '#d6dae1', fontSize: 11 },
        style: {
          stroke: color,
          strokeWidth: edge.kind === 'next' ? 1.5 : 2,
          strokeDasharray: edge.kind === 'branch' ? '5 4' : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      };
    });
  }, [graph]);

  if (!scene || !graph) {
    return <div className="flow-empty">還沒有場景可以畫。</div>;
  }

  const unreachable = graph.blocks.filter((b) => !b.reachable).length;
  const broken = graph.blocks.reduce((sum, b) => sum + b.broken, 0);

  return (
    <div className="flow-wrap">
      <div className="flow-bar">
        <span>
          {scene.nodes.length} 句摺成 <b>{graph.blocks.length}</b> 塊、{graph.edges.length} 條線
        </span>
        {unreachable > 0 && (
          <span className="is-warn" title="沒有任何路徑從場景起點到得了這些段落">
            {unreachable} 塊走不到
          </span>
        )}
        {broken > 0 && <span className="is-error">{broken} 個跳轉斷掉</span>}
        <span className="flow-legend">
          <i style={{ background: EDGE_COLOR.choice }} />選項
          <i style={{ background: EDGE_COLOR.branch }} />條件
          <i style={{ background: EDGE_COLOR.next }} />接續
        </span>
      </div>

      <div className="flow-canvas" ref={canvasRef}>
        {/* 空場景會畫出一片什麼都沒有的畫布，看起來像載入失敗。
            劇本 xlsx 裡「只有標題列」的工作表會匯入成空場景，這不算少見。 */}
        {graph.blocks.length === 0 && (
          <p className="flow-blank">這個場景還沒有內容。</p>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            flowRef.current = instance;
            // 一打開就對準目前編輯的那一句，沒有選取時就從場景開頭看起。
            const target = activeBlockId ?? graph.blocks[0]?.id;
            if (target) centerOn(target, INITIAL_ZOOM, 0);
          }}
          onMoveEnd={(_, viewport) => {
            zoomRef.current = viewport.zoom;
          }}
          // 唯讀：不能拖節點、不能連線、不能刪。
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          minZoom={0.05}
          proOptions={{ hideAttribution: false }}
          // 場景大時只畫看得到的部分，否則幾百塊一起 render 會卡住捲動。
          onlyRenderVisibleElements
        >
          <Background color="#2a2e36" gap={20} />
          <Controls showInteractive={false} />
          {/* 預設的 200×150 在窄面板上會蓋掉大半張圖 —— 這個面板本來就可以被
              拖到很窄，小地圖不該跟內容搶空間。 */}
          <MiniMap
            pannable
            zoomable
            nodeColor="#333842"
            maskColor="rgba(20,22,26,.75)"
            style={{ width: 132, height: 96 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
