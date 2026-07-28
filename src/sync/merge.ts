import { parseCellKey } from '../schema/keys';
import type { TagRegistry } from '../schema/tags';
import { parseText } from '../tags/parse';

/**
 * Excel 匯入的三方合併。
 *
 * 規則表見 docs/FORMAT.md §5。核心是：沒有 base（上次匯出的快照）就無法分辨
 * 「Excel 改了」與「編輯器改了」，匯入只能退化成整份覆蓋 —— 那會靜默吃掉
 * 編輯器這邊的修改。因此無快照時一律視為衝突交由使用者決定。
 *
 * 這個模組是純函式，不碰 UI 也不碰 ExcelJS，方便完整測試。
 */

export type CellStatus =
  /** 兩邊都沒動，或兩邊改成一樣。 */
  | 'unchanged'
  /** 只有 Excel 改了，可安全套用。 */
  | 'applied'
  /** 兩邊都改了，需要使用者決定。 */
  | 'conflict'
  /** Excel 的內容標記語法壞掉，不得靜默套用。 */
  | 'invalid';

export interface CellChange {
  cellKey: string;
  status: CellStatus;
  base: string | null;
  current: string;
  incoming: string;
  /** status 為 invalid 時，說明標記壞在哪。 */
  issues: string[];
}

export interface MergeReport {
  changes: CellChange[];
  /** Excel 有、專案沒有的列 —— 不自動新增。 */
  unknownRows: string[];
  /** 專案有、Excel 沒有的列 —— 不自動刪除。 */
  missingRows: string[];
  /** 唯讀欄被改動的列，僅提示。 */
  readonlyEdits: { rowKey: string; column: string; was: string; now: string }[];
  /** 沒有快照可比對，全部視為衝突。 */
  noSnapshot: boolean;
}

export interface MergeInput {
  /** 上次匯出的快照；null 代表沒有。 */
  base: Record<string, string> | null;
  /** 專案現況。 */
  current: Record<string, string>;
  /** 從 Excel 讀回來的內容。 */
  incoming: Record<string, string>;
  readonlyEdits?: MergeReport['readonlyEdits'];
  registry: TagRegistry;
}

function rowOf(cellKey: string): string {
  const ref = parseCellKey(cellKey);
  return ref ? `${ref.ownerKind}:${ref.ownerId}` : cellKey;
}

/**
 * 標記完整性檢查。
 *
 * 翻譯者最常見的破壞方式是只留下半邊標籤，或把 `[shake]` 一起翻譯掉。
 * 這類內容如果靜默套用，錯誤要等到遊戲跑起來才會被發現。
 */
function checkTags(text: string, registry: TagRegistry): string[] {
  return parseText(text, registry).issues.map((i) => i.message);
}

export function mergeCells(input: MergeInput): MergeReport {
  const { base, current, incoming, registry } = input;
  const noSnapshot = base === null;

  const changes: CellChange[] = [];
  const incomingRows = new Set<string>();
  const currentRows = new Set(Object.keys(current).map(rowOf));

  for (const [key, incomingValue] of Object.entries(incoming)) {
    const row = rowOf(key);
    incomingRows.add(row);
    if (!(key in current)) continue; // 未知列另外統計

    const currentValue = current[key] ?? '';
    const baseValue = base ? (base[key] ?? '') : null;

    if (incomingValue === currentValue) {
      changes.push({ cellKey: key, status: 'unchanged', base: baseValue, current: currentValue, incoming: incomingValue, issues: [] });
      continue;
    }

    const issues = checkTags(incomingValue, registry);
    if (issues.length > 0) {
      changes.push({ cellKey: key, status: 'invalid', base: baseValue, current: currentValue, incoming: incomingValue, issues });
      continue;
    }

    // 沒有快照時無從判斷是誰改的，一律當衝突。
    if (baseValue === null) {
      changes.push({ cellKey: key, status: 'conflict', base: null, current: currentValue, incoming: incomingValue, issues: [] });
      continue;
    }

    if (incomingValue === baseValue) {
      // Excel 沒動，是編輯器這邊改的 —— 不可回寫覆蓋。
      changes.push({ cellKey: key, status: 'unchanged', base: baseValue, current: currentValue, incoming: incomingValue, issues: [] });
      continue;
    }

    const status: CellStatus = currentValue === baseValue ? 'applied' : 'conflict';
    changes.push({ cellKey: key, status, base: baseValue, current: currentValue, incoming: incomingValue, issues: [] });
  }

  const unknownRows = [...new Set(Object.keys(incoming).map(rowOf))].filter(
    (row) => !currentRows.has(row),
  );
  const missingRows = [...currentRows].filter((row) => !incomingRows.has(row));

  return {
    changes,
    unknownRows,
    missingRows,
    readonlyEdits: input.readonlyEdits ?? [],
    noSnapshot,
  };
}

/**
 * 由合併報告產生「要實際寫回專案的格」。
 *
 * `applied` 預設採用，`conflict` 與 `invalid` 預設保留現況 —— 使用者可在報告
 * UI 逐項勾選來覆寫這個預設。安全的預設值是不動使用者已有的內容。
 */
export function defaultDecisions(report: MergeReport): Record<string, boolean> {
  const decisions: Record<string, boolean> = {};
  for (const change of report.changes) {
    if (change.status === 'applied') decisions[change.cellKey] = true;
    else if (change.status !== 'unchanged') decisions[change.cellKey] = false;
  }
  return decisions;
}

export function resolveAccepted(
  report: MergeReport,
  decisions: Record<string, boolean>,
): Record<string, string> {
  const accepted: Record<string, string> = {};
  for (const change of report.changes) {
    if (change.status === 'unchanged') continue;
    if (decisions[change.cellKey]) accepted[change.cellKey] = change.incoming;
  }
  return accepted;
}

export function summarize(report: MergeReport): Record<CellStatus, number> {
  const counts: Record<CellStatus, number> = { unchanged: 0, applied: 0, conflict: 0, invalid: 0 };
  for (const change of report.changes) counts[change.status] += 1;
  return counts;
}
