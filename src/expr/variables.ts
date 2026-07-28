import { BUILTIN_FUNCTIONS, type DeclaredType, type HostFunction } from './evaluate';
import {
  collectVariables,
  parseAssignment,
  parseExpression,
  parseInputTargets,
  type Expr,
} from './parse';
import type { StoryProject, Variable } from '../schema/story';

/**
 * 從劇本的運算式裡萃取變數宣告與型別。
 *
 * 匯入既有劇本時，變數只存在於運算式字串中 —— 沒有宣告，編輯器就無從
 * 檢查有沒有打錯名字，播放器也不知道初始值該是什麼。
 *
 * 型別是**走訪 AST** 推出來的，不是對字串做樣式比對：
 * 靠字串比對會把 `CalcAge(birthday, ...)` 的參數也誤判成數字。
 */

export interface VariableUsage {
  id: string;
  /** 被賦值過（`set` 的左側或 `input` 的目標）。 */
  assigned: boolean;
  /** 被讀取過（出現在條件或運算式右側）。 */
  read: boolean;
  type: DeclaredType;
}

type Known = Map<string, DeclaredType>;

/** 推測一段運算式的結果型別。unknown 代表證據不足。 */
function inferExpr(
  expr: Expr,
  known: Known,
  functions: Record<string, HostFunction>,
): DeclaredType | 'unknown' {
  switch (expr.kind) {
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'bool';
    case 'var':
      return known.get(expr.name) ?? 'unknown';
    case 'call':
      return functions[expr.name]?.returns ?? 'unknown';
    case 'unary':
      return expr.op === '!' ? 'bool' : 'number';
    case 'binary': {
      const { op } = expr;
      if (['==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(op)) return 'bool';
      if (op !== '+') return 'number';
      // `+` 只要有一邊是文字就是字串串接。日期在執行期就是字串，一併算進來。
      const left = inferExpr(expr.left, known, functions);
      const right = inferExpr(expr.right, known, functions);
      const textish = (t: typeof left) => t === 'string' || t === 'date';
      if (textish(left) || textish(right)) return 'string';
      if (left === 'number' && right === 'number') return 'number';
      return 'unknown';
    }
  }
}

/**
 * 從運算式的使用方式反推變數型別。
 *
 * `age < 25` → age 是數字；`Max(base, 25)` → base 是數字；
 * `CalcAge(birthday, ...)` → birthday 是日期（由函式自己宣告的參數型別決定，
 * 不是「出現在函式裡就當數字」）。
 */
function constrainFromUsage(
  expr: Expr,
  known: Known,
  functions: Record<string, HostFunction>,
): void {
  const markNumeric = (side: Expr) => {
    if (side.kind === 'var' && !known.has(side.name)) known.set(side.name, 'number');
  };

  if (expr.kind === 'binary') {
    if (['<', '<=', '>', '>=', '-', '*', '/', '%'].includes(expr.op)) {
      markNumeric(expr.left);
      markNumeric(expr.right);
    }
    constrainFromUsage(expr.left, known, functions);
    constrainFromUsage(expr.right, known, functions);
    return;
  }

  if (expr.kind === 'unary') {
    if (expr.op === '-') markNumeric(expr.operand);
    constrainFromUsage(expr.operand, known, functions);
    return;
  }

  if (expr.kind === 'call') {
    const fn = functions[expr.name];
    expr.args.forEach((arg, index) => {
      // arity 為 -1 時 params 只有一個，代表所有參數都是那個型別。
      const expected = fn?.arity === -1 ? fn.params[0] : fn?.params[index];
      if (expected && arg.kind === 'var' && !known.has(arg.name)) known.set(arg.name, expected);
      constrainFromUsage(arg, known, functions);
    });
  }
}

interface Statement {
  target?: string;
  expr?: Expr;
  inputTargets?: string[];
}

function collectStatements(project: StoryProject): Statement[] {
  const statements: Statement[] = [];

  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      for (const branch of node.branches) {
        const parsed = parseExpression(branch.condition);
        if (parsed.ok) statements.push({ expr: parsed.value });
      }
      if (node.kind === 'set') {
        const parsed = parseAssignment(node.expression ?? '');
        if (parsed.ok) statements.push({ target: parsed.value.target, expr: parsed.value.value });
      }
      if (node.kind === 'input') {
        const parsed = parseInputTargets(node.expression ?? '');
        if (parsed.ok) statements.push({ inputTargets: parsed.value });
      }
    }
  }

  return statements;
}

export function collectProjectVariables(
  project: StoryProject,
  functions: Record<string, HostFunction> = BUILTIN_FUNCTIONS,
): VariableUsage[] {
  const statements = collectStatements(project);
  const usage = new Map<string, { assigned: boolean; read: boolean }>();
  const touch = (id: string, how: 'assigned' | 'read') => {
    const entry = usage.get(id) ?? { assigned: false, read: false };
    entry[how] = true;
    usage.set(id, entry);
  };

  for (const statement of statements) {
    if (statement.target) touch(statement.target, 'assigned');
    for (const name of statement.inputTargets ?? []) touch(name, 'assigned');
    if (statement.expr) for (const name of collectVariables(statement.expr)) touch(name, 'read');
  }
  for (const scene of project.scenes) {
    for (const node of scene.nodes) {
      for (const action of node.actions) touch(action.variable, 'assigned');
    }
  }

  // 先從比較與算術取得硬證據，再由賦值往外傳播，重複到穩定為止。
  const known: Known = new Map();
  for (const statement of statements) {
    if (statement.expr) constrainFromUsage(statement.expr, known, functions);
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const statement of statements) {
      if (!statement.target || !statement.expr) continue;
      if (known.has(statement.target)) continue;
      const inferred = inferExpr(statement.expr, known, functions);
      if (inferred !== 'unknown') {
        known.set(statement.target, inferred);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return [...usage.entries()]
    .map(([id, entry]) => ({
      id,
      ...entry,
      // 證據不足時當字串：玩家輸入與日期都是字串，猜錯成數字會讓預設值變成 0。
      type: known.get(id) ?? 'string',
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const DEFAULT_BY_TYPE = {
  number: 0,
  string: '',
  bool: false,
  // 日期給空字串而非今天：預設成今天會讓「忘了填」看起來像「填好了」。
  date: '',
} as const;

/**
 * 把萃取出的變數補進專案，不覆蓋已存在的宣告。
 *
 * 只被讀取卻從未被賦值的變數代表它們由遊戲提供 ——
 * 在說明裡標出來，播放時才知道要從外部餵值。
 */
export function declareMissingVariables(project: StoryProject): Variable[] {
  const existing = new Set(project.variables.map((v) => v.id));
  const added: Variable[] = [];

  for (const usage of collectProjectVariables(project)) {
    if (existing.has(usage.id)) continue;
    added.push({
      id: usage.id,
      type: usage.type,
      default: DEFAULT_BY_TYPE[usage.type],
      description: usage.assigned ? '' : '劇本只讀取不設定，需由遊戲提供',
    });
  }

  project.variables = [...project.variables, ...added];
  return added;
}
