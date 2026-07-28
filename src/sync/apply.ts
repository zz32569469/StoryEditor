import { parseCellKey } from '../schema/keys';
import type { StoryProject } from '../schema/story';

/**
 * 把接受的儲存格寫回專案。
 *
 * 只寫既有實體的既有欄位 —— 找不到對應 id 的一律跳過（那些在報告裡已列為
 * 未知列）。這個函式不新增也不刪除任何實體。
 */
export function applyCells(
  project: StoryProject,
  accepted: Record<string, string>,
): { applied: number; skipped: number } {
  const nodes = new Map(project.scenes.flatMap((s) => s.nodes).map((n) => [n.id, n]));
  const choices = new Map(
    project.scenes.flatMap((s) => s.nodes).flatMap((n) => n.choices).map((c) => [c.id, c]),
  );
  const characters = new Map(project.characters.map((c) => [c.id, c]));

  let applied = 0;
  let skipped = 0;

  for (const [key, value] of Object.entries(accepted)) {
    const ref = parseCellKey(key);
    if (!ref) {
      skipped += 1;
      continue;
    }

    if (ref.ownerKind === 'node') {
      const node = nodes.get(ref.ownerId);
      if (!node) {
        skipped += 1;
        continue;
      }
      if (ref.field === 'notes') node.notes = value;
      else if (ref.field === 'text' && ref.lang) node.text[ref.lang] = value;
      else {
        skipped += 1;
        continue;
      }
      applied += 1;
      continue;
    }

    if (ref.ownerKind === 'choice') {
      const choice = choices.get(ref.ownerId);
      if (!choice || ref.field !== 'text' || !ref.lang) {
        skipped += 1;
        continue;
      }
      choice.text[ref.lang] = value;
      applied += 1;
      continue;
    }

    const character = characters.get(ref.ownerId);
    if (!character || ref.field !== 'name' || !ref.lang) {
      skipped += 1;
      continue;
    }
    character.name[ref.lang] = value;
    applied += 1;
  }

  return { applied, skipped };
}
