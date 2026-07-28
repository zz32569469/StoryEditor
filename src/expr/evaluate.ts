import type { Expr } from './parse';

/**
 * 運算式求值。
 *
 * 這份語意就是給 Unity 端照著實作的規格 —— 在這裡定義一次並寫成測試，
 * 比在 C# 裡臨時決定規則便宜得多，也不會兩邊行為不一致。
 */

export type Value = number | string | boolean;

/** 求值時真正存在的型別。 */
export type ValueType = 'number' | 'string' | 'bool';

/**
 * 使用者在介面上選的型別。
 *
 * 比執行期型別多一個「日期」—— 寫劇本的人不需要知道日期內部是字串，
 * 但需要一個明確的欄位告訴他該填什麼格式，介面也才能給日期選擇器。
 */
export const DECLARED_TYPES = ['number', 'string', 'bool', 'date'] as const;
export type DeclaredType = (typeof DECLARED_TYPES)[number];

/** 宣告型別 → 執行期型別。日期就是字串，只是介面上另外看待。 */
export function storageType(type: DeclaredType): ValueType {
  return type === 'date' ? 'string' : type;
}

/** 日期一律用 YYYY-MM-DD，與 <input type="date"> 的值格式一致。 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

export interface EvalContext {
  /** 變數目前的值。 */
  variables: Map<string, Value>;
  /** 可呼叫的函式。 */
  functions: Record<string, HostFunction>;
}

export interface HostFunction {
  /** 參數個數；-1 代表不限。 */
  arity: number;
  call: (args: Value[]) => Value;
  description: string;
  /**
   * 回傳型別。
   *
   * 用於推測變數型別 —— 少了它就只能靠「運算式裡有沒有出現函式名」猜，
   * 那會把 `CalcAge(birthday, ...)` 的**參數**也誤判成數字。
   */
  returns: DeclaredType;
  /**
   * 各參數的型別。arity 為 -1（不限個數）時只放一個，代表所有參數。
   *
   * 同樣是為了型別推測：`Max(base, 25)` 能推出 base 是數字，
   * 而 `CalcAge(birthday, ...)` 能推出 birthday 是日期。
   */
  params: DeclaredType[];
}

export type EvalResult = { ok: true; value: Value } | { ok: false; message: string };

function typeName(value: Value): string {
  return typeof value === 'boolean' ? '布林' : typeof value === 'number' ? '數字' : '字串';
}

/**
 * 真假判定。
 *
 * 空字串與 0 為假，其餘為真 —— 與大多數腳本語言一致，
 * 且條件多半直接寫比較運算，很少依賴這條規則。
 */
export function truthy(value: Value): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return value !== '';
}

/** 預設函式庫。遊戲特有的函式由呼叫端補上。 */
export const BUILTIN_FUNCTIONS: Record<string, HostFunction> = {
  Max: { arity: -1, returns: 'number', params: ['number'], description: '取最大值', call: (args) => Math.max(...args.map(Number)) },
  Min: { arity: -1, returns: 'number', params: ['number'], description: '取最小值', call: (args) => Math.min(...args.map(Number)) },
  Abs: { arity: 1, returns: 'number', params: ['number'], description: '絕對值', call: (args) => Math.abs(Number(args[0])) },
  Round: { arity: 1, returns: 'number', params: ['number'], description: '四捨五入', call: (args) => Math.round(Number(args[0])) },
  Floor: { arity: 1, returns: 'number', params: ['number'], description: '無條件捨去', call: (args) => Math.floor(Number(args[0])) },
  Ceil: { arity: 1, returns: 'number', params: ['number'], description: '無條件進位', call: (args) => Math.ceil(Number(args[0])) },
  Clamp: {
    arity: 3,
    returns: 'number',
    params: ['number', 'number', 'number'],
    description: '限制在範圍內',
    call: (args) => Math.min(Math.max(Number(args[0]), Number(args[1])), Number(args[2])),
  },
  Len: { arity: 1, returns: 'number', params: ['string'], description: '字串長度', call: (args) => String(args[0]).length },
  /**
   * 由出生日與基準日算出年齡。
   *
   * **這是編輯器預覽用的暫代實作** —— 真正的規則屬於遊戲。
   * Unity 端必須提供自己的版本，且兩邊行為要一致，否則預覽與實機會分歧。
   */
  CalcAge: {
    arity: 2,
    returns: 'number',
    params: ['date', 'date'],
    description: '（預覽暫代）由出生日與基準日算出年齡',
    call: (args) => {
      const birth = new Date(String(args[0]));
      const at = new Date(String(args[1]));
      if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return 0;
      let age = at.getFullYear() - birth.getFullYear();
      const monthDiff = at.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < birth.getDate())) age -= 1;
      return Math.max(0, age);
    },
  },
};

export function evaluate(expr: Expr, context: EvalContext): EvalResult {
  switch (expr.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return { ok: true, value: expr.value };

    case 'var': {
      const value = context.variables.get(expr.name);
      if (value === undefined) return { ok: false, message: `變數 "${expr.name}" 還沒有值` };
      return { ok: true, value };
    }

    case 'unary': {
      const operand = evaluate(expr.operand, context);
      if (!operand.ok) return operand;
      if (expr.op === '!') return { ok: true, value: !truthy(operand.value) };
      if (typeof operand.value !== 'number') {
        return { ok: false, message: `負號不能用在${typeName(operand.value)}上` };
      }
      return { ok: true, value: -operand.value };
    }

    case 'call': {
      const fn = context.functions[expr.name];
      if (!fn) return { ok: false, message: `沒有這個函式："${expr.name}"` };

      const args: Value[] = [];
      for (const argExpr of expr.args) {
        const arg = evaluate(argExpr, context);
        if (!arg.ok) return arg;
        args.push(arg.value);
      }
      if (fn.arity >= 0 && args.length !== fn.arity) {
        return { ok: false, message: `${expr.name} 需要 ${fn.arity} 個參數，收到 ${args.length} 個` };
      }
      try {
        return { ok: true, value: fn.call(args) };
      } catch (error) {
        return { ok: false, message: `${expr.name} 執行失敗：${String(error)}` };
      }
    }

    case 'binary':
      return evaluateBinary(expr, context);
  }
}

function evaluateBinary(
  expr: Extract<Expr, { kind: 'binary' }>,
  context: EvalContext,
): EvalResult {
  // && 與 || 短路，右側可能因此不被求值（右側有未定義變數時這很重要）。
  if (expr.op === '&&' || expr.op === '||') {
    const left = evaluate(expr.left, context);
    if (!left.ok) return left;
    const leftTruthy = truthy(left.value);
    if (expr.op === '&&' && !leftTruthy) return { ok: true, value: false };
    if (expr.op === '||' && leftTruthy) return { ok: true, value: true };
    const right = evaluate(expr.right, context);
    if (!right.ok) return right;
    return { ok: true, value: truthy(right.value) };
  }

  const left = evaluate(expr.left, context);
  if (!left.ok) return left;
  const right = evaluate(expr.right, context);
  if (!right.ok) return right;

  const a = left.value;
  const b = right.value;

  if (expr.op === '==') return { ok: true, value: a === b };
  if (expr.op === '!=') return { ok: true, value: a !== b };

  if (expr.op === '+') {
    // 任一邊是字串就當作字串相加（fullName = lastName + firstName）。
    if (typeof a === 'string' || typeof b === 'string') {
      return { ok: true, value: `${String(a)}${String(b)}` };
    }
    if (typeof a === 'number' && typeof b === 'number') return { ok: true, value: a + b };
    return { ok: false, message: `${typeName(a)}與${typeName(b)}不能相加` };
  }

  if (typeof a !== 'number' || typeof b !== 'number') {
    return { ok: false, message: `"${expr.op}" 兩邊都必須是數字（收到${typeName(a)}與${typeName(b)}）` };
  }

  switch (expr.op) {
    case '-': return { ok: true, value: a - b };
    case '*': return { ok: true, value: a * b };
    case '/':
      if (b === 0) return { ok: false, message: '除以零' };
      return { ok: true, value: a / b };
    case '%':
      if (b === 0) return { ok: false, message: '除以零' };
      return { ok: true, value: a % b };
    case '<': return { ok: true, value: a < b };
    case '<=': return { ok: true, value: a <= b };
    case '>': return { ok: true, value: a > b };
    case '>=': return { ok: true, value: a >= b };
  }

  return { ok: false, message: `尚未支援的運算子 "${expr.op}"` };
}
