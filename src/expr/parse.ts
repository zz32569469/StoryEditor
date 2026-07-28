/**
 * 條件與賦值運算式的解析器。
 *
 * 語言刻意做得小：來源劇本實際只用到數值比較、字串相加與兩個函式。
 * 但保留了 `&& || != * / %` 等常見運算子 —— 這些遲早會用到，
 * 事後再加會讓已經寫好的劇本面臨語法變更。
 *
 * 與標記解析器一樣**永不拋例外**：使用者會邊打字邊看結果，
 * 半個運算式是常態而非錯誤情境。
 */

export type BinaryOp =
  | '||' | '&&'
  | '==' | '!='
  | '<' | '<=' | '>' | '>='
  | '+' | '-' | '*' | '/' | '%';

export type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: '!' | '-'; operand: Expr }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] };

/** `set` 節點的內容：`名稱 = 運算式`。 */
export interface Assignment {
  target: string;
  value: Expr;
}

export interface ParseError {
  message: string;
  index: number;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };

// ---------------------------------------------------------------- 詞法

type TokenType = 'number' | 'string' | 'name' | 'op' | 'eof';

interface Token {
  type: TokenType;
  text: string;
  /** 數字與字串的實際值。 */
  value?: number | string;
  index: number;
}

const OPERATORS = [
  '&&', '||', '==', '!=', '<=', '>=',
  '<', '>', '+', '-', '*', '/', '%', '(', ')', ',', '!', '=',
];

function tokenize(input: string): ParseResult<Token[]> {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const start = i;
      while (i < input.length && /[0-9.]/.test(input[i]!)) i += 1;
      const text = input.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        return { ok: false, error: { message: `"${text}" 不是有效的數字`, index: start } };
      }
      tokens.push({ type: 'number', text, value, index: start });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i += 1;
      let out = '';
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          out += input[i + 1];
          i += 2;
          continue;
        }
        out += input[i];
        i += 1;
      }
      if (input[i] !== quote) {
        return { ok: false, error: { message: '字串沒有結束的引號', index: start } };
      }
      i += 1;
      tokens.push({ type: 'string', text: input.slice(start, i), value: out, index: start });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) i += 1;
      tokens.push({ type: 'name', text: input.slice(start, i), index: start });
      continue;
    }

    const op = OPERATORS.find((candidate) => input.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: 'op', text: op, index: i });
      i += op.length;
      continue;
    }

    return { ok: false, error: { message: `無法辨識的字元 "${ch}"`, index: i } };
  }

  tokens.push({ type: 'eof', text: '', index: input.length });
  return { ok: true, value: tokens };
}

// ---------------------------------------------------------------- 語法

/** 由低到高。數字越大越先結合。 */
const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3, '!=': 3,
  '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }

  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  private expectOp(op: string): ParseError | null {
    const token = this.peek();
    if (token.type === 'op' && token.text === op) {
      this.pos += 1;
      return null;
    }
    return { message: `這裡需要 "${op}"`, index: token.index };
  }

  atEnd(): boolean {
    return this.peek().type === 'eof';
  }

  current(): Token {
    return this.peek();
  }

  parseExpression(minPrecedence = 0): ParseResult<Expr> {
    let left = this.parseUnary();
    if (!left.ok) return left;

    for (;;) {
      const token = this.peek();
      if (token.type !== 'op') break;
      const precedence = PRECEDENCE[token.text];
      if (precedence === undefined || precedence <= minPrecedence) break;

      this.pos += 1;
      const right = this.parseExpression(precedence);
      if (!right.ok) return right;
      left = {
        ok: true,
        value: { kind: 'binary', op: token.text as BinaryOp, left: left.value, right: right.value },
      };
    }

    return left;
  }

  private parseUnary(): ParseResult<Expr> {
    const token = this.peek();
    if (token.type === 'op' && (token.text === '!' || token.text === '-')) {
      this.pos += 1;
      const operand = this.parseUnary();
      if (!operand.ok) return operand;
      return { ok: true, value: { kind: 'unary', op: token.text, operand: operand.value } };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ParseResult<Expr> {
    const token = this.next();

    if (token.type === 'number') {
      return { ok: true, value: { kind: 'number', value: token.value as number } };
    }
    if (token.type === 'string') {
      return { ok: true, value: { kind: 'string', value: token.value as string } };
    }

    if (token.type === 'name') {
      const lower = token.text.toLowerCase();
      if (lower === 'true' || lower === 'false') {
        return { ok: true, value: { kind: 'boolean', value: lower === 'true' } };
      }

      // 後面接 ( 就是函式呼叫。
      const after = this.peek();
      if (after.type === 'op' && after.text === '(') {
        this.pos += 1;
        const args: Expr[] = [];
        if (!(this.peek().type === 'op' && this.peek().text === ')')) {
          for (;;) {
            const arg = this.parseExpression();
            if (!arg.ok) return arg;
            args.push(arg.value);
            const separator = this.peek();
            if (separator.type === 'op' && separator.text === ',') {
              this.pos += 1;
              continue;
            }
            break;
          }
        }
        const error = this.expectOp(')');
        if (error) return { ok: false, error };
        return { ok: true, value: { kind: 'call', name: token.text, args } };
      }

      return { ok: true, value: { kind: 'var', name: token.text } };
    }

    if (token.type === 'op' && token.text === '(') {
      const inner = this.parseExpression();
      if (!inner.ok) return inner;
      const error = this.expectOp(')');
      if (error) return { ok: false, error };
      return inner;
    }

    return {
      ok: false,
      error: {
        message: token.type === 'eof' ? '運算式突然結束' : `這裡不該出現 "${token.text}"`,
        index: token.index,
      },
    };
  }
}

/** 解析一段條件運算式（`if` 節點的內容）。 */
export function parseExpression(input: string): ParseResult<Expr> {
  if (!input.trim()) return { ok: false, error: { message: '運算式是空的', index: 0 } };

  const tokens = tokenize(input);
  if (!tokens.ok) return tokens;

  const parser = new Parser(tokens.value);
  const result = parser.parseExpression();
  if (!result.ok) return result;
  if (!parser.atEnd()) {
    const token = parser.current();
    return { ok: false, error: { message: `多餘的內容 "${token.text}"`, index: token.index } };
  }
  return result;
}

/** 解析一段賦值（`set` 節點的內容）。 */
export function parseAssignment(input: string): ParseResult<Assignment> {
  if (!input.trim()) return { ok: false, error: { message: '賦值是空的', index: 0 } };

  const tokens = tokenize(input);
  if (!tokens.ok) return tokens;

  const [target, equals] = tokens.value;
  if (target?.type !== 'name') {
    return { ok: false, error: { message: '賦值要以變數名開頭', index: target?.index ?? 0 } };
  }
  if (!(equals?.type === 'op' && equals.text === '=')) {
    return { ok: false, error: { message: '變數名後面需要 "="', index: equals?.index ?? 0 } };
  }

  const parser = new Parser(tokens.value.slice(2));
  const value = parser.parseExpression();
  if (!value.ok) return value;
  if (!parser.atEnd()) {
    const token = parser.current();
    return { ok: false, error: { message: `多餘的內容 "${token.text}"`, index: token.index } };
  }
  return { ok: true, value: { target: target.text, value: value.value } };
}

/** 解析 `input` 節點的內容：一到多個以逗號分隔的變數名。 */
export function parseInputTargets(input: string): ParseResult<string[]> {
  const names = input.split(',').map((s) => s.trim());
  if (names.length === 0 || names.some((n) => !n)) {
    return { ok: false, error: { message: '輸入節點需要一到多個變數名（以逗號分隔）', index: 0 } };
  }
  const bad = names.find((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  if (bad) return { ok: false, error: { message: `"${bad}" 不是合法的變數名`, index: 0 } };
  return { ok: true, value: names };
}

/**
 * 在運算式中把某個變數改名。
 *
 * 用詞法而非字串取代 —— 直接 replace 會誤傷函式名、字串字面值，
 * 以及 `age` 出現在 `ageLimit` 之中的情形。
 * 保留原本的空白與寫法，只換掉真正是該變數的識別字。
 */
export function renameIdentifier(source: string, from: string, to: string): string {
  const tokens = tokenize(source);
  if (!tokens.ok) return source;

  let out = '';
  let cursor = 0;

  tokens.value.forEach((token, index) => {
    if (token.type !== 'name' || token.text !== from) return;
    // 後面接 ( 的是函式名，不是變數。
    const next = tokens.value[index + 1];
    if (next?.type === 'op' && next.text === '(') return;

    out += source.slice(cursor, token.index) + to;
    cursor = token.index + token.text.length;
  });

  return out + source.slice(cursor);
}

/** 走訪運算式中出現的所有變數名。 */
export function collectVariables(expr: Expr, out = new Set<string>()): Set<string> {
  switch (expr.kind) {
    case 'var':
      out.add(expr.name);
      break;
    case 'unary':
      collectVariables(expr.operand, out);
      break;
    case 'binary':
      collectVariables(expr.left, out);
      collectVariables(expr.right, out);
      break;
    case 'call':
      for (const arg of expr.args) collectVariables(arg, out);
      break;
  }
  return out;
}
