import type { Stage } from '../schema/story';
import { parseAttributeChanges, type AttributeChange } from './attributes';

/**
 * 演出欄位的解析（格式見 docs/FORMAT.md §3.5）。
 *
 * 這裡是規格：Unity 端的 StageParser 逐欄照著實作，黃金測資（directives.json）
 * 由這支程式產生、C# 讀同一份比對。寫錯的指令一律記進 issues，不丟例外 ——
 * 劇情不能因為一格演出欄位寫錯就停下來。
 */

/** 一格多個指令：全形逗號為主，半形也收。 */
const SEPARATOR = /[，,]/;
/** 「無」代表清除或收起。 */
export const NONE = '無';

export interface ScreenCommand {
  /** 正規化後的指令名（別名會換成這裡的名字）。 */
  name: string;
  /** 補齊預設值之後的數字參數。 */
  args: number[];
  /** 只有 `input` 有：舊寫法 OpenNameInput 之類的輸入種類（Name／Birthday／Level）。 */
  key?: string;
}

export interface ScreenCommandDef {
  name: string;
  aliases: string[];
  /** 依序的參數預設值；長度就是最多能帶幾個參數。 */
  defaults: number[];
  description: string;
}

/** 畫面效果的指令表。網頁端與 Unity 端共用同一份定義（Unity 端照抄並由黃金測資把關）。 */
export const SCREEN_COMMANDS: ScreenCommandDef[] = [
  { name: '睜眼', aliases: ['睜眼效果'], defaults: [1.2], description: '從全黑由上下張開' },
  { name: '閉眼', aliases: ['閉眼效果'], defaults: [1.0], description: '由上下闔起成全黑' },
  { name: '黑幕', aliases: [], defaults: [], description: '立刻全黑，保持到淡入或睜眼' },
  { name: '淡出', aliases: [], defaults: [0.5], description: '畫面漸漸變黑' },
  { name: '淡入', aliases: [], defaults: [0.5], description: '從黑漸漸恢復' },
  { name: '溶接', aliases: [], defaults: [0.5], description: '這一列的背景／插圖替換用交叉淡化' },
  { name: '震動', aliases: [], defaults: [0.3, 1], description: '整個畫面晃動（秒、強度）' },
  { name: '閃白', aliases: [], defaults: [0.2], description: '白光一閃' },
];

/**
 * 舊劇本把「開輸入框」寫在畫面效果欄（OpenNameInput 之類）。
 * 輸入現在由 `in` 列處理；這些寫法照收，轉成 `input` 指令讓遊戲自行決定要不要理會。
 */
const INPUT_HINT = /^Open(\w+)Input$/;

export interface BgmCommand {
  /** null = 停止。 */
  key: string | null;
  /** 淡入／淡出秒數。 */
  fade: number;
}

export interface ItemChange {
  key: string;
  count: number;
}

export interface ParsedStage {
  /** undefined = 這一列沒寫；key 為 null = 「無」（換成全黑）。 */
  background?: { key: string | null };
  cg?: { key: string | null };
  screen: ScreenCommand[];
  sfx: string[];
  bgm?: BgmCommand;
  attributes: AttributeChange[];
  items: ItemChange[];
  unlocks: string[];
  target?: string;
  issues: string[];
}

export const BGM_STOP = '停止';
export const BGM_DEFAULT_FADE = 1;

function split(text: string | undefined): string[] {
  if (!text) return [];
  return text.split(SEPARATOR).map((s) => s.trim()).filter(Boolean);
}

function words(part: string): string[] {
  return part.split(/\s+/).filter(Boolean);
}

/** 數字參數：只收十進位數字，避免 `1e3`、`0x10` 這種寫法在兩端解讀不同。 */
function parseNumber(raw: string): number | null {
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null;
}

function keyOrNone(text: string | undefined, column: string, issues: string[]): { key: string | null } | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  if (value === NONE) return { key: null };
  if (/\s/.test(value)) issues.push(`${column}「${value}」只能寫一個代號`);
  return { key: value };
}

function parseScreen(text: string | undefined, issues: string[]): ScreenCommand[] {
  const commands: ScreenCommand[] = [];
  for (const part of split(text)) {
    const [head, ...rest] = words(part);
    const input = INPUT_HINT.exec(head!);
    if (input) {
      commands.push({ name: 'input', args: [], key: input[1] });
      continue;
    }
    const def = SCREEN_COMMANDS.find((d) => d.name === head || d.aliases.includes(head!));
    if (!def) {
      issues.push(`畫面效果「${head}」不認得（可用：${SCREEN_COMMANDS.map((d) => d.name).join('、')}）`);
      continue;
    }
    if (rest.length > def.defaults.length) {
      issues.push(`畫面效果「${part}」參數太多，${def.name}最多 ${def.defaults.length} 個`);
      continue;
    }
    const args = [...def.defaults];
    let ok = true;
    rest.forEach((raw, i) => {
      const value = parseNumber(raw);
      if (value === null) {
        issues.push(`畫面效果「${part}」的參數「${raw}」不是數字`);
        ok = false;
        return;
      }
      args[i] = value;
    });
    if (ok) commands.push({ name: def.name, args });
  }
  return commands;
}

function parseBgm(text: string | undefined, issues: string[]): BgmCommand | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  const [head, fadeRaw, ...extra] = words(value);
  if (extra.length > 0) issues.push(`OST「${value}」只能寫「代號 秒數」或「停止 秒數」`);
  let fade = BGM_DEFAULT_FADE;
  if (fadeRaw !== undefined) {
    const parsed = parseNumber(fadeRaw);
    if (parsed === null) issues.push(`OST「${value}」的秒數「${fadeRaw}」不是數字`);
    else fade = parsed;
  }
  return { key: head === BGM_STOP ? null : head!, fade };
}

/** `代號×數量`，`x`／`X`／`*` 也收；省略數量 = 1。 */
const ITEM = /^(.+?)\s*[×xX*＊]\s*(\d+)$/;

function parseItems(text: string | undefined, issues: string[]): ItemChange[] {
  const items: ItemChange[] = [];
  for (const part of split(text)) {
    const match = ITEM.exec(part);
    if (match) {
      items.push({ key: match[1]!.trim(), count: Number(match[2]) });
      continue;
    }
    if (/[×xX*＊]\s*$/.test(part) || /\s/.test(part)) {
      issues.push(`物品消耗「${part}」寫法是「代號×數量」`);
      continue;
    }
    items.push({ key: part, count: 1 });
  }
  return items;
}

export function parseStage(stage: Stage | undefined): ParsedStage {
  const issues: string[] = [];
  const attributes = parseAttributeChanges(stage?.attributes ?? '');
  for (const part of attributes.malformed) {
    issues.push(`屬性變化「${part}」看不懂，寫法是「名稱±數字」，多個用「，」分隔`);
  }
  const parsed: ParsedStage = {
    screen: parseScreen(stage?.screenEffect, issues),
    sfx: split(stage?.sfx),
    attributes: attributes.changes,
    items: parseItems(stage?.items, issues),
    unlocks: split(stage?.unlocks),
    issues,
  };
  const background = keyOrNone(stage?.background, '背景', issues);
  if (background) parsed.background = background;
  const cg = keyOrNone(stage?.cg, '插圖', issues);
  if (cg) parsed.cg = cg;
  const bgm = parseBgm(stage?.bgm, issues);
  if (bgm) parsed.bgm = bgm;
  const target = stage?.target?.trim();
  if (target) parsed.target = target;
  return parsed;
}

export function isEmptyStage(stage: Stage | undefined): boolean {
  return !stage || Object.values(stage).every((v) => !v?.trim());
}
