import type { TagDef, TagRegistry, TagSyntax } from '../schema/tags';

export type { TagSyntax };

/**
 * 特效標記的解析器。
 *
 * 語法（完整規格見 docs/FORMAT.md §3）：
 *   成對  [shake amp=3]文字[/shake]
 *   單點  [wait=0.5]
 *   簡寫  [color=#ff3333]   等同 [color value=#ff3333]
 *   轉義  \[ \{ 與 \\
 *
 * **方括號與大括號都可以**：`[b]…[/b]` 與 `{b}…{/b}` 等價，開頭與結尾必須成對。
 * 兩種都收是為了讓既有劇本直接可用 —— 不同團隊的既定慣例不一樣，
 * 逼人改寫幾百句台詞只為了遷就工具是本末倒置。
 *
 * 解析器**永不拋例外** —— 使用者邊打字邊解析，半個標籤是常態而非錯誤情境。
 * 錯誤以清單回傳，同時盡可能產出可渲染的結果。
 */

export type TagParamValue = string | number | boolean;

export interface ResolvedTag {
  name: string;
  params: Record<string, TagParamValue>;
}

export interface ParsedChar {
  char: string;
  /** 作用中的成對標籤，由外而內。 */
  effects: ResolvedTag[];
  /** 在這個字顯示「之前」要觸發的單點標籤（wait / speed / sfx）。 */
  before: ResolvedTag[];
}

export interface TagIssue {
  message: string;
  /** 在原字串中的位置，供編輯器標示。 */
  index: number;
}

export interface ParsedText {
  chars: ParsedChar[];
  /** 全文結束後才觸發的單點標籤。 */
  trailing: ResolvedTag[];
  /** 去除標記後的純文字。 */
  plain: string;
  issues: TagIssue[];
}

const COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * 標記只用方括號與大括號。
 *
 * **尖括號不是標記** —— 在這份劇本裡 `<age>`、`<lastName>` 是變數插值
 * （見 interpolate.ts）。若把 `<...>` 也當標記，兩者會互相打架。
 */
export const DELIMITERS: Record<TagSyntax, { open: string; close: string }> = {
  bracket: { open: '[', close: ']' },
  brace: { open: '{', close: '}' },
};

export function syntaxOf(char: string): TagSyntax | null {
  if (char === '[') return 'bracket';
  if (char === '{') return 'brace';
  return null;
}

interface RawTag {
  /** 這個標籤用的是哪一組括號。 */
  syntax: TagSyntax;
  closing: boolean;
  name: string;
  /** 原始字串形式的參數，尚未依 registry 轉型。 */
  rawParams: { key: string; value: string }[];
  /** `[color=#f00]` 的位置參數值。 */
  positionalValue: string | null;
  start: number;
  end: number;
}

/** 讀出開括號到對應閉括號之間的內容。回傳 null 代表這不是一個完整的標籤。 */
function readTag(input: string, start: number): RawTag | null {
  const syntax = syntaxOf(input[start]!);
  if (!syntax) return null;
  const { close } = DELIMITERS[syntax];

  let i = start + 1;
  const closing = input[i] === '/';
  if (closing) i += 1;

  const nameStart = i;
  while (i < input.length && /[a-z0-9_-]/i.test(input[i]!)) i += 1;
  const name = input.slice(nameStart, i).toLowerCase();
  if (!name) return null;

  let positionalValue: string | null = null;
  const rawParams: { key: string; value: string }[] = [];

  const readValue = (): string | null => {
    if (input[i] === '"') {
      i += 1;
      let out = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          out += input[i + 1];
          i += 2;
          continue;
        }
        out += input[i];
        i += 1;
      }
      if (input[i] !== '"') return null;
      i += 1;
      return out;
    }
    const valueStart = i;
    // 兩種閉括號都當作終止符：值裡本來就不該出現裸的 ] 或 }。
    while (i < input.length && !/[\s\]}]/.test(input[i]!)) i += 1;
    return input.slice(valueStart, i);
  };

  if (input[i] === '=') {
    i += 1;
    const value = readValue();
    if (value === null) return null;
    positionalValue = value;
  }

  while (i < input.length && input[i] !== close) {
    if (/\s/.test(input[i]!)) {
      i += 1;
      continue;
    }
    const keyStart = i;
    while (i < input.length && /[a-z0-9_-]/i.test(input[i]!)) i += 1;
    const key = input.slice(keyStart, i).toLowerCase();
    if (!key || input[i] !== '=') return null;
    i += 1;
    const value = readValue();
    if (value === null) return null;
    rawParams.push({ key, value });
  }

  if (input[i] !== close) return null;
  return { syntax, closing, name, rawParams, positionalValue, start, end: i + 1 };
}

function coerce(
  raw: string,
  type: 'number' | 'string' | 'color' | 'boolean',
): { ok: true; value: TagParamValue } | { ok: false; reason: string } {
  switch (type) {
    case 'number': {
      // 百分比寫法（size=130%）換算成倍率 1.3 —— TMP 的 <size=130%> 就是這個語意，
      // 既有劇本大量使用，不接受等於逼人重寫。
      const percent = raw.trim().endsWith('%');
      const n = Number(percent ? raw.trim().slice(0, -1) : raw);
      if (!Number.isFinite(n)) return { ok: false, reason: `"${raw}" 不是數字` };
      return { ok: true, value: percent ? n / 100 : n };
    }
    case 'boolean': {
      const lower = raw.toLowerCase();
      if (['true', '1', 'yes'].includes(lower)) return { ok: true, value: true };
      if (['false', '0', 'no'].includes(lower)) return { ok: true, value: false };
      return { ok: false, reason: `"${raw}" 不是布林值` };
    }
    case 'color':
      return COLOR_RE.test(raw)
        ? { ok: true, value: raw }
        : { ok: false, reason: `"${raw}" 不是合法色碼（例 #ff3333）` };
    case 'string':
      return { ok: true, value: raw };
  }
}

/** 依 registry 把原始標籤轉成已驗證、已填預設值的形式。 */
function resolve(
  raw: RawTag,
  def: TagDef,
  issues: TagIssue[],
): ResolvedTag {
  const params: Record<string, TagParamValue> = {};
  const supplied = new Map<string, string>();

  if (raw.positionalValue !== null) {
    if (def.positional) {
      supplied.set(def.positional, raw.positionalValue);
    } else {
      issues.push({ message: `標籤 [${def.name}] 不支援 = 簡寫`, index: raw.start });
    }
  }
  for (const { key, value } of raw.rawParams) {
    if (!def.params.some((p) => p.name === key)) {
      issues.push({ message: `標籤 [${def.name}] 沒有參數 "${key}"`, index: raw.start });
      continue;
    }
    supplied.set(key, value);
  }

  for (const param of def.params) {
    const rawValue = supplied.get(param.name);
    if (rawValue === undefined) {
      if (param.default !== undefined) params[param.name] = param.default;
      else issues.push({ message: `標籤 [${def.name}] 缺少必要參數 "${param.name}"`, index: raw.start });
      continue;
    }
    const result = coerce(rawValue, param.type);
    if (result.ok) params[param.name] = result.value;
    else issues.push({ message: `[${def.name}] 的 ${param.name}：${result.reason}`, index: raw.start });
  }

  return { name: def.name, params };
}

export function parseText(input: string, registry: TagRegistry): ParsedText {
  const defs = new Map(registry.map((t) => [t.name, t]));
  const chars: ParsedChar[] = [];
  const issues: TagIssue[] = [];
  const openStack: { tag: ResolvedTag; start: number; syntax: TagSyntax }[] = [];
  let pending: ResolvedTag[] = [];

  const pushChar = (char: string) => {
    chars.push({ char, effects: openStack.map((o) => o.tag), before: pending });
    pending = [];
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;

    if (ch === '\\' && i + 1 < input.length) {
      pushChar(input[i + 1]!);
      i += 2;
      continue;
    }

    if (syntaxOf(ch) === null) {
      pushChar(ch);
      i += 1;
      continue;
    }

    const raw = readTag(input, i);
    if (!raw) {
      issues.push({
        message: `標籤未正確結束（缺少 ${DELIMITERS[syntaxOf(ch)!].close} 或格式錯誤）`,
        index: i,
      });
      pushChar(ch);
      i += 1;
      continue;
    }

    const show = (name: string, syntax: TagSyntax, closing = false) => {
      const { open, close } = DELIMITERS[syntax];
      return `${open}${closing ? '/' : ''}${name}${close}`;
    };

    const def = defs.get(raw.name);
    if (!def) {
      issues.push({ message: `未知的標籤 ${show(raw.name, raw.syntax)}`, index: raw.start });
      i = raw.end;
      continue;
    }

    if (raw.closing) {
      if (def.kind === 'inline') {
        issues.push({
          message: `${show(def.name, raw.syntax)} 是單點標籤，不需要結束標籤`,
          index: raw.start,
        });
      } else {
        const top = openStack[openStack.length - 1];
        if (!top) {
          issues.push({
            message: `多餘的結束標籤 ${show(def.name, raw.syntax, true)}`,
            index: raw.start,
          });
        } else if (top.tag.name !== def.name) {
          issues.push({
            message:
              `結束標籤 ${show(def.name, raw.syntax, true)} 與最近的 ` +
              `${show(top.tag.name, top.syntax)} 不匹配`,
            index: raw.start,
          });
        } else if (top.syntax !== raw.syntax) {
          // 開頭用方括號、結尾用大括號（或反過來）。兩種都合法，但不能混用同一組。
          issues.push({
            message:
              `${show(top.tag.name, top.syntax)} 要用 ${show(top.tag.name, top.syntax, true)} 結束，` +
              `不是 ${show(def.name, raw.syntax, true)}`,
            index: raw.start,
          });
          openStack.pop();
        } else {
          openStack.pop();
        }
      }
      i = raw.end;
      continue;
    }

    const resolved = resolve(raw, def, issues);
    if (def.kind === 'inline') pending.push(resolved);
    else openStack.push({ tag: resolved, start: raw.start, syntax: raw.syntax });
    i = raw.end;
  }

  for (const unclosed of openStack) {
    issues.push({
      message: `標籤 ${DELIMITERS[unclosed.syntax].open}${unclosed.tag.name}${DELIMITERS[unclosed.syntax].close} 沒有結束標籤`,
      index: unclosed.start,
    });
  }

  return {
    chars,
    trailing: pending,
    plain: chars.map((c) => c.char).join(''),
    issues,
  };
}

/** 只取純文字，供字數統計與 Excel 的上下文欄使用。 */
export function stripTags(input: string, registry: TagRegistry): string {
  return parseText(input, registry).plain;
}

function formatValue(value: TagParamValue): string {
  const text = String(value);
  return /[\s\]}"]/.test(text) ? `"${text.replace(/(["\\])/g, '\\$1')}"` : text;
}

function formatTag(tag: ResolvedTag, def: TagDef | undefined, syntax: TagSyntax): string {
  const { open, close } = DELIMITERS[syntax];
  if (!def || def.params.length === 0) return `${open}${tag.name}${close}`;

  const parts: string[] = [];
  let head = tag.name;
  for (const param of def.params) {
    const value = tag.params[param.name];
    if (value === undefined || value === param.default) continue;
    if (param.name === def.positional) head = `${tag.name}=${formatValue(value)}`;
    else parts.push(`${param.name}=${formatValue(value)}`);
  }
  return `${open}${[head, ...parts].join(' ')}${close}`;
}

/**
 * 把解析結果寫回標準形式的標記字串。
 *
 * 這不是「還原原文」—— 空白、預設值與括號種類都會正規化成 `syntax` 指定的形式。
 * 它的用途是讓編輯器的視覺化操作（例如選取一段字後按下「抖動」）能產生合法標記，
 * 以及驗證 parse 的結果自洽。
 *
 * 注意：目前**沒有任何流程會用它改寫使用者輸入的台詞** —— 匯入的劇本原文
 * 一字不動地保存，不會被偷偷正規化成另一種括號。
 */
export function stringifyText(
  parsed: ParsedText,
  registry: TagRegistry,
  syntax: TagSyntax = 'bracket',
): string {
  const defs = new Map(registry.map((t) => [t.name, t]));
  const closer = DELIMITERS[syntax];
  // 兩種開括號都要轉義，否則寫出來的文字再解析一次會多出標籤。
  const escape = (char: string) =>
    char === '[' || char === '{' || char === '\\' ? `\\${char}` : char;

  let out = '';
  let open: ResolvedTag[] = [];

  const closeDownTo = (depth: number) => {
    for (let d = open.length - 1; d >= depth; d -= 1) {
      out += `${closer.open}/${open[d]!.name}${closer.close}`;
    }
    open = open.slice(0, depth);
  };

  for (const char of parsed.chars) {
    let shared = 0;
    while (
      shared < open.length &&
      shared < char.effects.length &&
      open[shared] === char.effects[shared]
    ) {
      shared += 1;
    }
    closeDownTo(shared);
    for (const tag of char.effects.slice(shared)) {
      out += formatTag(tag, defs.get(tag.name), syntax);
      open.push(tag);
    }
    for (const tag of char.before) out += formatTag(tag, defs.get(tag.name), syntax);
    out += escape(char.char);
  }

  closeDownTo(0);
  for (const tag of parsed.trailing) out += formatTag(tag, defs.get(tag.name), syntax);
  return out;
}
