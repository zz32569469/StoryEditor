import type { Worksheet } from 'exceljs';

import { declareMissingVariables } from '../expr/variables';
import { createEmptyProject } from '../schema/factory';
import { newId } from '../schema/ids';
import type {
  Branch,
  Character,
  Choice,
  Scene,
  StoryNode,
  StoryProject,
} from '../schema/story';
import type { TagSyntax } from '../schema/tags';
import { COLUMN_ALIASES, SEMANTIC_HEADERS, findColumn, toMarker, type Marker } from './format';

/**
 * 把既有劇本表格轉成專案。
 *
 * 純函式（吃 ArrayBuffer），瀏覽器與 CLI 共用。
 */

export interface LegacyImportReport {
  scenes: number;
  rows: number;
  nodesByKind: Record<string, number>;
  choices: number;
  branches: number;
  characters: string[];
  extrasKept: Record<string, number>;
  tagSyntax: TagSyntax;
  /** 從運算式萃取出來、自動補上宣告的變數。 */
  variables: string[];
  /** 只被讀取卻從未被設定的變數 —— 這些必須由遊戲提供初始值。 */
  externalVariables: string[];
  warnings: string[];
}

interface RawRow {
  excelRow: number;
  marker: Marker;
  id: string;
  group: string;
  person: string;
  portrait: string;
  content: string;
  jump: string;
  /** 標誌欄的原值，`` 與 `#` 都是台詞但要分辨才能原樣寫回。 */
  markerRaw: string;
  extras: Record<string, string>;
}

/** 人物標籤 → 角色代號。KeySchema 只收小寫英數、底線與連字號。 */
function toCharacterId(label: string): string {
  const id = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id || 'unknown';
}

function readHeaders(sheet: Worksheet): string[] {
  const headers: string[] = [];
  for (let c = 1; c <= sheet.columnCount; c += 1) {
    headers.push(String(sheet.getRow(1).getCell(c).text ?? '').trim());
  }
  return headers;
}

function readRows(sheet: Worksheet, headers: string[], warnings: string[]): RawRow[] {
  const cols = {
    marker: findColumn(headers, 'marker'),
    id: findColumn(headers, 'id'),
    group: findColumn(headers, 'group'),
    person: findColumn(headers, 'person'),
    portrait: findColumn(headers, 'portrait'),
    content: findColumn(headers, 'content'),
    jump: findColumn(headers, 'jump'),
  };

  if (cols.id === 0 || cols.content === 0) {
    if (headers.some(Boolean)) {
      warnings.push(
        `工作表「${sheet.name}」缺少「${COLUMN_ALIASES.id[0]}」或「${COLUMN_ALIASES.content[0]}」欄，已略過`,
      );
    }
    return [];
  }

  // 有語意以外的欄位一律原樣保留。
  const extraCols = headers
    .map((name, index) => ({ name, index: index + 1 }))
    .filter((c) => c.name && !SEMANTIC_HEADERS.has(c.name));

  const rows: RawRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const get = (index: number) => (index > 0 ? String(row.getCell(index).text ?? '').trim() : '');

    const id = get(cols.id);
    const content = get(cols.content);
    const markerRaw = get(cols.marker);
    if (id === '' && content === '' && markerRaw === '') continue;
    if (id === '') {
      warnings.push(`「${sheet.name}」第 ${r} 列沒有 ID，已略過`);
      continue;
    }

    const extras: Record<string, string> = {};
    for (const col of extraCols) {
      const value = get(col.index);
      if (value) extras[col.name] = value;
    }

    rows.push({
      excelRow: r,
      marker: toMarker(markerRaw),
      markerRaw,
      id,
      group: get(cols.group),
      person: get(cols.person),
      portrait: get(cols.portrait),
      content,
      jump: get(cols.jump),
      extras,
    });
  }

  return rows;
}

/**
 * 一個 q／if 群組轉成**一個節點**，而不是掛在跳進來的那個節點上。
 *
 * 實際劇本裡有多個節點跳進同一個群組（對話 hub）—— 若把選項複製到每個入口節點，
 * 選項就會有多份 id，Excel 的雙向同步立刻失效。讓群組自成節點則天然共用。
 */
function convertSheet(
  sheetName: string,
  headers: string[],
  rows: RawRow[],
  characters: Map<string, Character>,
  report: LegacyImportReport,
): Scene {
  const byId = new Map(rows.map((row) => [row.id, row]));

  const groupMembers = new Map<string, RawRow[]>();
  for (const row of rows) {
    if (row.marker !== 'q' && row.marker !== 'if') continue;
    const key = `${row.marker}:${row.group || `_solo_${row.id}`}`;
    groupMembers.set(key, [...(groupMembers.get(key) ?? []), row]);
  }

  const groupKeyOf = new Map<string, string>();
  const groupLeader = new Map<string, string>();
  for (const [key, members] of groupMembers) {
    for (const member of members) groupKeyOf.set(member.id, key);
    groupLeader.set(key, members[0]!.id);
  }

  /** 來源 ID → 代表該列的節點的來源 ID（群組成員一律指向組長）。 */
  const canonicalId = (sourceId: string): string =>
    groupLeader.get(groupKeyOf.get(sourceId) ?? '') ?? sourceId;

  const ulidOf = new Map<string, string>();
  for (const row of rows) {
    const canonical = canonicalId(row.id);
    if (!ulidOf.has(canonical)) ulidOf.set(canonical, newId());
  }

  const resolveJump = (raw: string, from: RawRow): string | null => {
    const target = raw.trim();
    if (!target) return null;
    if (!byId.has(target)) {
      report.warnings.push(`「${sheetName}」ID ${from.id} 跳轉到不存在的 ${target}，已改為結束`);
      return null;
    }
    return ulidOf.get(canonicalId(target)) ?? null;
  };

  const registerCharacter = (label: string): string | undefined => {
    // 空白與 narration 都是旁白 —— 編輯器用「沒有說話者」表示。
    if (!label || label.toLowerCase() === 'narration') return undefined;
    const id = toCharacterId(label);
    if (!characters.has(id)) characters.set(id, { id, name: { zh: label } });
    return id;
  };

  const nodes: StoryNode[] = [];
  const emitted = new Set<string>();

  for (const row of rows) {
    const canonical = canonicalId(row.id);
    if (emitted.has(canonical)) continue;
    emitted.add(canonical);

    const leader = byId.get(canonical) ?? row;
    const groupKey = groupKeyOf.get(row.id);
    const members = groupKey ? groupMembers.get(groupKey)! : [leader];

    // 每一種列都可能標了人物（控制列多半是 system）。全部保留，
    // 否則 in／set／if 的人物欄在匯出時會憑空消失。
    const leaderSpeaker = registerCharacter(leader.person);

    const base = {
      id: ulidOf.get(canonical)!,
      text: {} as Record<string, string>,
      choices: [] as Choice[],
      next: null as string | null,
      actions: [],
      notes: '',
      branches: [] as Branch[],
      speaker: leaderSpeaker,
      // 旁白（narration／空白）沒有角色，原始標籤記在 extras 供匯出還原。
      extras:
        leader.person && !leaderSpeaker
          ? { ...leader.extras, 人物: leader.person }
          : leader.extras,
      source: { id: leader.id, marker: leader.markerRaw, group: leader.group },
      sourceJump: leader.jump,
    };

    if (leader.marker === 'q') {
      // 每個選項各自記人物 —— 同一組裡「（不介入）」可能是 system 而非玩家。
      const choices: Choice[] = members.map((member) => ({
        id: newId(),
        text: { zh: member.content },
        targetNodeId: resolveJump(member.jump, member),
        sourceId: member.id,
        sourceJump: member.jump,
        speaker: registerCharacter(member.person),
        extras: member.extras,
      }));
      report.choices += choices.length;

      nodes.push({ ...base, kind: 'line', choices });
      continue;
    }

    if (leader.marker === 'if') {
      const branches: Branch[] = members.map((member) => ({
        id: newId(),
        condition: member.content,
        targetNodeId: resolveJump(member.jump, member),
        sourceId: member.id,
        sourceJump: member.jump,
        speaker: registerCharacter(member.person),
        extras: member.extras,
      }));
      report.branches += branches.length;
      nodes.push({ ...base, kind: 'branch', branches });
      continue;
    }

    if (leader.marker === 'set' || leader.marker === 'in') {
      nodes.push({
        ...base,
        kind: leader.marker === 'set' ? 'set' : 'input',
        expression: leader.content,
        next: resolveJump(leader.jump, leader),
      });
      continue;
    }

    if (leader.marker === 'end') {
      nodes.push({ ...base, kind: 'end' });
      continue;
    }

    nodes.push({
      ...base,
      kind: 'line',
      text: { zh: leader.content },
      // 立繪代號原樣保留（來源常用「便服-微笑」這類中文命名）。
      portrait: leader.portrait || undefined,
      next: resolveJump(leader.jump, leader),
    });
  }

  for (const node of nodes) {
    report.nodesByKind[node.kind] = (report.nodesByKind[node.kind] ?? 0) + 1;
    for (const key of Object.keys(node.extras)) {
      report.extrasKept[key] = (report.extrasKept[key] ?? 0) + 1;
    }
  }

  return {
    id: newId(),
    name: sheetName.trim(),
    entryNodeId: nodes[0]?.id ?? null,
    nodes,
    sourceColumns: headers.filter(Boolean),
  };
}

/** 數哪一種括號的標記比較多。兩者皆可解析，這只影響「新插入的」標記。 */
function detectTagSyntax(project: StoryProject): TagSyntax {
  let brace = 0;
  let bracket = 0;
  const count = (text: string) => {
    brace += (text.match(/\{\/?[a-z][a-z0-9_-]*[^}]*\}/gi) ?? []).length;
    bracket += (text.match(/\[\/?[a-z][a-z0-9_-]*[^\]]*\]/gi) ?? []).length;
  };
  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      for (const text of Object.values(node.text)) count(text);
      for (const choice of node.choices) for (const text of Object.values(choice.text)) count(text);
    }
  }
  return brace > bracket ? 'brace' : 'bracket';
}

export async function importLegacyWorkbook(
  data: ArrayBuffer,
  projectName: string,
): Promise<{ project: StoryProject; report: LegacyImportReport }> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);

  const project = createEmptyProject(projectName, ['zh']);
  const characters = new Map<string, Character>();
  const report: LegacyImportReport = {
    scenes: 0,
    rows: 0,
    nodesByKind: {},
    choices: 0,
    branches: 0,
    characters: [],
    extrasKept: {},
    tagSyntax: 'bracket',
    variables: [],
    externalVariables: [],
    warnings: [],
  };

  for (const sheet of workbook.worksheets) {
    const headers = readHeaders(sheet);
    const rows = readRows(sheet, headers, report.warnings);
    report.rows += rows.length;
    if (rows.length === 0) {
      report.warnings.push(`工作表「${sheet.name}」沒有資料列，未建立場景`);
      continue;
    }
    project.scenes.push(convertSheet(sheet.name, headers, rows, characters, report));
    report.scenes += 1;
  }

  project.characters = [...characters.values()];
  report.characters = project.characters.map((c) => c.id);
  project.meta.tagSyntax = detectTagSyntax(project);
  report.tagSyntax = project.meta.tagSyntax;

  // 變數只存在於運算式字串裡，宣告出來編輯器才能檢查、播放器才知道初始值。
  report.variables = declareMissingVariables(project).map((v) => v.id);
  report.externalVariables = project.variables
    .filter((v) => v.description.includes('遊戲提供'))
    .map((v) => v.id);

  return { project, report };
}
