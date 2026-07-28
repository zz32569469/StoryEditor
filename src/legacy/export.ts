import type { StoryNode, StoryProject } from '../schema/story';
import { COLUMN_ALIASES, DEFAULT_COLUMNS, findColumn, markerFor } from './format';

/**
 * 把專案以**來源劇本的格式**匯出。
 *
 * 目標是原樣往返：同樣的工作表、同樣的欄位順序、同樣的 ID 與跳轉編號。
 * 節點身上的 `source` 記錄了它原本的列，沒有 `source` 的（編輯器新增的內容）
 * 才配發新編號。
 *
 * 這與「匯出翻譯用 Excel」是兩件不同的事：那份是給譯者的文字視圖，
 * 靠 row_key 做三方合併；這份是完整的劇本表，給既有製作流程使用。
 */

export interface LegacyExportResult {
  blob: Blob;
  sheets: number;
  rows: number;
  /** 沒有來源編號、由匯出時配發新編號的列數。 */
  newIds: number;
}

/** 一列輸出資料：欄名 → 值。 */
type OutRow = Record<string, string>;

/**
 * 配發表內不重複的 ID。
 *
 * 沿用既有編號，新內容從現有最大值往後接 —— 不重新編號整張表，
 * 否則任何依賴這些編號的既有流程都會斷掉。
 */
function makeIdAllocator(existing: Iterable<string>) {
  const taken = new Set(existing);
  let next = 0;
  for (const id of taken) {
    const n = Number(id);
    if (Number.isInteger(n) && n >= next) next = n + 1;
  }
  return {
    taken,
    allocate(): string {
      while (taken.has(String(next))) next += 1;
      const id = String(next);
      taken.add(id);
      next += 1;
      return id;
    },
  };
}

/** 收集一個場景中所有已存在的來源編號。 */
function existingIds(nodes: StoryNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.source) ids.push(node.source.id);
    for (const choice of node.choices) if (choice.sourceId) ids.push(choice.sourceId);
    for (const branch of node.branches) if (branch.sourceId) ids.push(branch.sourceId);
  }
  return ids;
}

export async function exportLegacyWorkbook(project: StoryProject): Promise<LegacyExportResult> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'StoryEditor';
  workbook.created = new Date();

  const base = project.meta.baseLanguage;
  const characterLabel = new Map(
    project.characters.map((c) => [c.id, c.name[base] ?? Object.values(c.name)[0] ?? c.id]),
  );
  /** 角色代號 → 來源表使用的人物標籤（例如 mc_os → "mc os"）。 */
  const labelOf = (id: string | undefined): string | undefined =>
    id ? (characterLabel.get(id) ?? id) : undefined;

  let totalRows = 0;
  let newIds = 0;

  for (const scene of project.scenes) {
    const headers = scene.sourceColumns?.length ? scene.sourceColumns : DEFAULT_COLUMNS;
    const alloc = makeIdAllocator(existingIds(scene.nodes));

    // 先決定每個節點與每個選項／分支的編號，跳轉才有對象可指。
    const nodeId = new Map<string, string>();
    const rowIdOf = new Map<string, string>();
    for (const node of scene.nodes) {
      const id = node.source?.id ?? (newIds += 1, alloc.allocate());
      nodeId.set(node.id, id);
      rowIdOf.set(node.id, id);

      // 群組的第一列與節點共用同一個編號 —— 來源就是這個慣例，
      // 別處的跳轉都指向群組的第一列。
      const members = node.choices.length > 0 ? node.choices : node.branches;
      members.forEach((member, index) => {
        const memberId =
          member.sourceId ?? (index === 0 ? id : (newIds += 1, alloc.allocate()));
        rowIdOf.set(member.id, memberId);
      });
    }

    // 來源編號 → 它所屬的節點，用來判斷原始跳轉是否仍然有效。
    const nodeBySourceId = new Map<string, string>();
    for (const node of scene.nodes) {
      if (node.source) nodeBySourceId.set(node.source.id, node.id);
      for (const choice of node.choices) {
        if (choice.sourceId) nodeBySourceId.set(choice.sourceId, node.id);
      }
      for (const branch of node.branches) {
        if (branch.sourceId) nodeBySourceId.set(branch.sourceId, node.id);
      }
    }

    /**
     * 決定跳轉欄要寫什麼。
     *
     * 來源的跳轉可以精確指到群組中的某一列，但編輯器只認得「群組節點」。
     * 因此只要目標節點沒被改動，就原樣寫回原始編號；改過了才寫新解析的編號。
     */
    const jumpTo = (targetNodeId: string | null, sourceJump?: string): string => {
      if (sourceJump && nodeBySourceId.get(sourceJump) === targetNodeId) return sourceJump;
      return nodeId.get(targetNodeId ?? '') ?? '';
    };

    const out: OutRow[] = [];
    for (const node of scene.nodes) {
      const marker = markerFor(node.kind, node.choices.length > 0);
      const speaker = node.speaker
        ? (characterLabel.get(node.speaker) ?? node.speaker)
        : (node.extras['人物'] ?? '');

      // 群組的每一列有自己的製作欄位，所以 common 只放整個節點共通的部分 ——
      // 把節點的 extras 也塞進來的話，第一個成員的欄位會被複製到所有成員身上。
      const common: OutRow = { 人物: speaker, 組: node.source?.group ?? '' };

      if (node.choices.length > 0) {
        for (const choice of node.choices) {
          out.push({
            ...common,
            ...choice.extras,
            標誌: 'q',
            ID: rowIdOf.get(choice.id) ?? '',
            人物: labelOf(choice.speaker) ?? speaker,
            內容: choice.text[base] ?? '',
            跳轉: jumpTo(choice.targetNodeId, choice.sourceJump),
          });
        }
        continue;
      }

      if (node.kind === 'branch') {
        for (const branch of node.branches) {
          out.push({
            ...common,
            ...branch.extras,
            標誌: 'if',
            ID: rowIdOf.get(branch.id) ?? '',
            人物: labelOf(branch.speaker) ?? speaker,
            內容: branch.condition,
            跳轉: jumpTo(branch.targetNodeId, branch.sourceJump),
          });
        }
        continue;
      }

      out.push({
        ...common,
        ...node.extras,
        標誌: marker ?? node.source?.marker ?? '',
        ID: rowIdOf.get(node.id) ?? '',
        人物: speaker,
        立繪: node.portrait ?? '',
        內容: node.kind === 'line' ? (node.text[base] ?? '') : (node.expression ?? ''),
        跳轉: node.kind === 'end' ? '' : jumpTo(node.next, node.sourceJump),
      });
    }

    const sheet = workbook.addWorksheet(scene.name);
    sheet.columns = headers.map((header) => ({ header, key: header, width: columnWidth(header) }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const row of out) {
      sheet.addRow(headers.map((header) => row[header] ?? '')).alignment = {
        vertical: 'top',
        wrapText: true,
      };
    }

    totalRows += out.length;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    sheets: project.scenes.length,
    rows: totalRows,
    newIds,
  };
}

function columnWidth(header: string): number {
  if (COLUMN_ALIASES.content.includes(header as never)) return 60;
  if (COLUMN_ALIASES.person.includes(header as never)) return 12;
  if (COLUMN_ALIASES.marker.includes(header as never)) return 6;
  if (COLUMN_ALIASES.id.includes(header as never)) return 6;
  if (COLUMN_ALIASES.group.includes(header as never)) return 6;
  if (COLUMN_ALIASES.jump.includes(header as never)) return 6;
  return 14;
}

/** 匯出前檢查：找出會導致跳轉寫不出來的問題。 */
export function checkLegacyExport(project: StoryProject): string[] {
  const problems: string[] = [];
  for (const scene of project.scenes) {
    const inScene = new Set(scene.nodes.map((n) => n.id));
    for (const node of scene.nodes) {
      const targets = [
        node.next,
        ...node.choices.map((c) => c.targetNodeId),
        ...node.branches.map((b) => b.targetNodeId),
      ].filter((t): t is string => t !== null);

      for (const target of targets) {
        if (!inScene.has(target)) {
          // 來源格式的跳轉只能指向同一張工作表，跨場景無法表達。
          problems.push(`場景「${scene.name}」有跳轉指向其他場景的節點，來源格式無法表示`);
          break;
        }
      }
    }
    if (findColumn(scene.sourceColumns ?? DEFAULT_COLUMNS, 'id') === 0) {
      problems.push(`場景「${scene.name}」的欄位定義缺少 ID 欄`);
    }
  }
  return [...new Set(problems)];
}
