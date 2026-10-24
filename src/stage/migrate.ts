import { stageFieldOf } from '../legacy/format';
import type { Stage, StoryProject } from '../schema/story';

/**
 * 1.5.0 以前，演出欄位（背景、畫面效果、屬性變化…）匯入時只放在 extras。
 * 開舊檔時把它們搬進 stage，播放與檢查才看得到；extras 裡不再留一份，免得兩邊不同步。
 * 已經有 stage 的欄位不覆蓋。
 */
export function migrateStageExtras(project: StoryProject): StoryProject {
  const move = (holder: { stage?: Stage; extras: Record<string, string> }) => {
    for (const [header, value] of Object.entries(holder.extras)) {
      const field = stageFieldOf(header);
      if (!field) continue;
      delete holder.extras[header];
      if (!value || holder.stage?.[field]) continue;
      holder.stage = { ...holder.stage, [field]: value };
    }
  };
  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      // q／if 群組節點上的 extras 是第一列的複本，演出屬於成員，這裡只清掉不搬
      if (node.choices.length > 0 || node.kind === 'branch') {
        for (const header of Object.keys(node.extras)) if (stageFieldOf(header)) delete node.extras[header];
      } else {
        move(node);
      }
      node.choices.forEach(move);
      node.branches.forEach(move);
    }
  }
  return project;
}
