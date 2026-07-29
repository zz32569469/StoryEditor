import { readFileSync } from 'node:fs';
import { buildSceneGraph } from '../src/graph/build';
import { layoutGraph } from '../src/graph/layout';
import { validateStoryProject } from '../src/schema/validate';

const raw = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const result = validateStoryProject(raw);
if (!result.project) throw new Error('驗證失敗');
const project = result.project;
const focus = process.argv[3];

if (focus) {
  const scene = project.scenes.find((s) => s.name.includes(focus))!;
  const graph = buildSceneGraph(project, scene, 'zh');
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const srcOf = (id: string | null | undefined) => (id ? (byId.get(id)?.source?.id ?? '?') : '結束');

  console.log(`場景「${scene.name}」 起點=${srcOf(scene.entryNodeId)}\n`);
  for (const block of graph.blocks) {
    const head = byId.get(block.id)!;
    const tail = byId.get(block.nodeIds[block.nodeIds.length - 1]!)!;
    const outs = graph.edges.filter((e) => e.source === block.id);
    console.log(
      `${block.reachable ? '  ' : '✗ '}[${srcOf(block.id)}${block.nodeIds.length > 1 ? `–${srcOf(tail.id)}` : ''}] ` +
        `${block.kind} in=${block.jumpIn} → ${outs.map((e) => srcOf(e.target)).join(',') || (block.terminal ? '結束' : '—')}` +
        `   ${(head.text.zh ?? tail.expression ?? '').slice(0, 30)}`,
    );
  }
} else {
  let totalBlocks = 0;
  let totalNodes = 0;
  let totalUnreachable = 0;
  for (const scene of project.scenes) {
    const graph = buildSceneGraph(project, scene, 'zh');
    const placed = layoutGraph(graph.blocks, graph.edges);
    const unreachable = graph.blocks.filter((b) => !b.reachable);
    const hubs = graph.blocks.filter((b) => b.jumpIn > 1);
    const broken = graph.blocks.reduce((s, b) => s + b.broken, 0);
    const ranks = new Set(placed.map((p) => p.y)).size;
    const lanes = new Set(placed.map((p) => p.x)).size;

    totalBlocks += graph.blocks.length;
    totalNodes += scene.nodes.length;
    totalUnreachable += unreachable.length;

    console.log(
      `${scene.name.padEnd(14)} ${String(scene.nodes.length).padStart(4)} 句 → ` +
        `${String(graph.blocks.length).padStart(3)} 塊 / ${String(graph.edges.length).padStart(3)} 線  ` +
        `${String(ranks).padStart(2)} 層 × ${lanes} 行  hub ${hubs.length}  走不到 ${unreachable.length}  斷 ${broken}`,
    );
    for (const block of unreachable) {
      console.log(`      走不到：${block.kind}「${block.lines[0]?.summary.slice(0, 28)}」`);
    }
  }
  console.log(`\n合計 ${totalNodes} 句 → ${totalBlocks} 塊，走不到 ${totalUnreachable} 塊`);
}
