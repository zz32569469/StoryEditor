import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { BUILTIN_FUNCTIONS, evaluate, type Value } from '../src/expr/evaluate';
import { parseAssignment, parseExpression, parseInputTargets } from '../src/expr/parse';
import {
  advance,
  choose,
  startScene,
  submitInput,
  type PlayerState,
  type PlayerStatus,
} from '../src/runtime/player';
import { FORMAT_VERSION, type StoryNode, type StoryProject } from '../src/schema/story';

/**
 * 產生黃金測資：C# 端讀同一份跑一遍，結果不一致就是兩邊分歧。
 *
 * 期望值一律由**編輯器實際使用的程式碼**算出，不是手寫的。
 * 手寫期望值只能證明「我以為它會這樣」，證明不了兩邊真的一致；
 * 而且 TS 那邊改了行為時，手寫的期望值不會跟著動，測試就變成假的綠燈。
 */

const OUT = resolve(import.meta.dirname, '../unity-runtime/Tests~/golden');

interface EncodedValue {
  type: 'number' | 'string' | 'bool';
  value: number | string | boolean;
  /** String(value) 的結果 —— 插值進台詞時看到的就是這個。 */
  display: string;
}

function encode(value: Value): EncodedValue {
  const type = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'string';
  // JSON 沒有 Infinity 與 NaN（JSON.stringify 會寫成 null），那樣測資會失去資訊。
  // 比對一律以 display 為準：type + display 已經唯一決定一個值，
  // 而且「最短可還原」的數字表示法一個 double 只對應一種寫法。
  const json = typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  return { type, value: json, display: String(value) };
}

// ---------------------------------------------------------------- 運算式

interface ExprCase {
  source: string;
  variables: Record<string, EncodedValue>;
  /** 解析階段就失敗。 */
  parseError?: string;
  result?: EncodedValue;
  /** 求值階段失敗。 */
  evalError?: string;
}

function exprCase(source: string, variables: Record<string, Value> = {}): ExprCase {
  const encodedVars: Record<string, EncodedValue> = {};
  for (const [name, value] of Object.entries(variables)) encodedVars[name] = encode(value);

  const parsed = parseExpression(source);
  if (!parsed.ok) {
    return { source, variables: encodedVars, parseError: parsed.error.message };
  }

  const result = evaluate(parsed.value, {
    variables: new Map(Object.entries(variables)),
    functions: BUILTIN_FUNCTIONS,
  });
  return result.ok
    ? { source, variables: encodedVars, result: encode(result.value) }
    : { source, variables: encodedVars, evalError: result.message };
}

const NUMBERS = { a: 3, b: 4, zero: 0, neg: -2.5 };
const MIXED = { name: '柚葉', count: 2, flag: true, empty: '' };

const expressions: ExprCase[] = [
  // 算術與優先序
  exprCase('1 + 2 * 3'),
  exprCase('(1 + 2) * 3'),
  exprCase('10 - 3 - 2'),
  exprCase('10 / 4'),
  exprCase('10 % 3'),
  exprCase('-7 % 3'),
  exprCase('2 * a + b', NUMBERS),
  exprCase('-neg', NUMBERS),
  exprCase('a / zero', NUMBERS),
  exprCase('a % zero', NUMBERS),

  // 數字的字面與格式
  exprCase('0.1 + 0.2'),
  exprCase('1 / 3'),
  exprCase('.5 + 1'),
  exprCase('1000000 * 1000000'),
  exprCase('0 - 0'),

  // 字串
  exprCase("'你好' + name", MIXED),
  exprCase("name + count", MIXED),
  exprCase("count + name", MIXED),
  exprCase("flag + name", MIXED),
  exprCase("'引號\\'裡面'"),
  exprCase('"雙引號"'),

  // 比較與相等（=== 語意：跨型別一律不等）
  exprCase('a < b', NUMBERS),
  exprCase('a >= 3', NUMBERS),
  exprCase("count == 2", MIXED),
  exprCase("count == '2'", MIXED),
  exprCase("name == '柚葉'", MIXED),
  exprCase("flag == true", MIXED),
  exprCase("flag == 1", MIXED),
  exprCase("count != 3", MIXED),

  // 真假判定與短路
  exprCase('!0'),
  exprCase("!''"),
  exprCase('!5'),
  exprCase("!'x'"),
  exprCase('false && missingVariable'),
  exprCase('true || missingVariable'),
  exprCase('true && missingVariable'),
  exprCase('empty || count', MIXED),
  exprCase('count && name', MIXED),

  // 型別錯誤
  exprCase("name - 1", MIXED),
  exprCase("name < 1", MIXED),
  exprCase('flag + count', MIXED),
  exprCase('-name', MIXED),
  exprCase('missingVariable + 1'),

  // 內建函式
  exprCase('Max(1, 5, 3)'),
  exprCase('Min(1, 5, 3)'),
  exprCase('Max()'),
  exprCase('Min()'),
  exprCase('Abs(-4.5)'),
  exprCase('Round(2.5)'),
  exprCase('Round(3.5)'),
  exprCase('Round(-1.5)'),
  exprCase('Round(-2.5)'),
  exprCase('Floor(-1.2)'),
  exprCase('Ceil(-1.2)'),
  exprCase('Clamp(15, 0, 10)'),
  exprCase('Clamp(-5, 0, 10)'),
  exprCase("Len('柚葉登場')"),
  exprCase('Len(12345)'),
  exprCase("Max('5', 3)"),
  exprCase('Abs(true)'),
  exprCase("Max('0x10', 1)"),
  exprCase("Max('', 5)"),
  exprCase("Len(true)"),
  exprCase('Abs(1, 2)'),
  exprCase('NotAFunction(1)'),
  exprCase("CalcAge('2000-03-15', '2026-03-14')"),
  exprCase("CalcAge('2000-03-15', '2026-03-15')"),
  exprCase("CalcAge('2000-03-15', '2026-03-16')"),
  exprCase("CalcAge('壞掉的日期', '2026-01-01')"),

  // 實際劇本裡的條件
  exprCase('composure >= 75', { composure: 80 }),
  exprCase('composure <= 74', { composure: 80 }),
  exprCase('composure <= 24', { composure: 10 }),

  // 解析錯誤
  exprCase('1.2.3'),
  exprCase("'沒有結束"),
  exprCase('1 +'),
  exprCase('1 2'),
  exprCase(''),
  exprCase('(1 + 2'),
  exprCase('1 & 2'),
];

// ---------------------------------------------------------------- 賦值

interface AssignmentCase {
  source: string;
  variables: Record<string, EncodedValue>;
  parseError?: string;
  target?: string;
  result?: EncodedValue;
  evalError?: string;
}

function assignmentCase(source: string, variables: Record<string, Value> = {}): AssignmentCase {
  const encodedVars: Record<string, EncodedValue> = {};
  for (const [name, value] of Object.entries(variables)) encodedVars[name] = encode(value);

  const parsed = parseAssignment(source);
  if (!parsed.ok) return { source, variables: encodedVars, parseError: parsed.error.message };

  const result = evaluate(parsed.value.value, {
    variables: new Map(Object.entries(variables)),
    functions: BUILTIN_FUNCTIONS,
  });
  return result.ok
    ? { source, variables: encodedVars, target: parsed.value.target, result: encode(result.value) }
    : { source, variables: encodedVars, target: parsed.value.target, evalError: result.message };
}

const assignments: AssignmentCase[] = [
  assignmentCase('gold = 10'),
  assignmentCase('gold = gold + 5', { gold: 12 }),
  assignmentCase("fullName = lastName + firstName", { lastName: '柚', firstName: '葉' }),
  assignmentCase('age = CalcAge(birthday, today)', { birthday: '2001-06-30', today: '2026-07-30' }),
  assignmentCase('flag = true'),
  assignmentCase('level = Clamp(raw, 1, 99)', { raw: 150 }),
  assignmentCase('= 10'),
  assignmentCase('gold 10'),
  assignmentCase(''),
  assignmentCase('gold = '),
];

// ---------------------------------------------------------------- 輸入節點

interface InputCase {
  source: string;
  names?: string[];
  error?: string;
}

function inputCase(source: string): InputCase {
  const parsed = parseInputTargets(source);
  return parsed.ok ? { source, names: parsed.value } : { source, error: parsed.error.message };
}

const inputs: InputCase[] = [
  inputCase('playerName'),
  inputCase('firstName, lastName'),
  inputCase('  spaced  ,  names  '),
  inputCase('a,,b'),
  inputCase('1bad'),
  inputCase(''),
];

// ---------------------------------------------------------------- 整場走訪

type Step = ['advance'] | ['choose', string] | ['input', Record<string, Value>];

interface Snapshot {
  status: PlayerStatus;
  nodeId: string | null;
  error: string | null;
  visited: string[];
  pendingInputs: string[];
  variables: Record<string, EncodedValue>;
}

interface PlaythroughCase {
  name: string;
  project: StoryProject;
  sceneId: string;
  initialVariables: Record<string, EncodedValue>;
  steps: Step[];
  /** 起點一個，之後每走一步一個。 */
  snapshots: Snapshot[];
}

function snapshot(state: PlayerState): Snapshot {
  const variables: Record<string, EncodedValue> = {};
  for (const key of [...state.variables.keys()].sort()) {
    variables[key] = encode(state.variables.get(key)!);
  }
  return {
    status: state.status,
    nodeId: state.nodeId,
    error: state.error,
    visited: [...state.visited],
    pendingInputs: [...state.pendingInputs],
    variables,
  };
}

function playthrough(
  name: string,
  project: StoryProject,
  sceneId: string,
  steps: Step[],
  initialVariables: Record<string, Value> = {},
): PlaythroughCase {
  let state = startScene(project, sceneId, { initialVariables });
  const snapshots: Snapshot[] = [snapshot(state)];

  for (const step of steps) {
    if (step[0] === 'advance') state = advance(project, state);
    else if (step[0] === 'choose') state = choose(project, state, step[1]);
    else state = submitInput(project, state, step[1]);
    snapshots.push(snapshot(state));
  }

  const encodedInitial: Record<string, EncodedValue> = {};
  for (const [key, value] of Object.entries(initialVariables)) encodedInitial[key] = encode(value);

  return { name, project, sceneId, initialVariables: encodedInitial, steps, snapshots };
}

/** 直接手刻節點：id 用可讀字串，測資壞掉時看得出是哪一句。 */
function node(id: string, patch: Partial<StoryNode> = {}): StoryNode {
  return {
    id,
    kind: 'line',
    text: { zh: id },
    choices: [],
    next: null,
    actions: [],
    notes: '',
    branches: [],
    extras: {},
    ...patch,
  };
}

function project(nodes: StoryNode[], variables: StoryProject['variables'] = []): StoryProject {
  return {
    meta: {
      formatVersion: FORMAT_VERSION,
      projectName: '走訪測資',
      languages: ['zh'],
      baseLanguage: 'zh',
      updatedAt: '',
      tagSyntax: 'brace',
    },
    tagRegistry: [],
    variables,
    characters: [],
    scenes: [{ id: 'scene', name: '測試', entryNodeId: nodes[0]?.id ?? null, nodes }],
    exportSnapshot: null,
  };
}

const linear = project([
  node('a', { next: 'b' }),
  node('b', { next: 'c' }),
  node('c', { next: null }),
]);

const withChoices = project([
  node('start', {
    choices: [
      { id: 'c1', text: { zh: '左' }, targetNodeId: 'left', extras: {} },
      { id: 'c2', text: { zh: '右' }, targetNodeId: 'right', extras: {} },
    ],
  }),
  node('left', { next: 'end' }),
  node('right', { next: 'end' }),
  node('end', { kind: 'end' }),
]);

const withBranch = project(
  [
    node('open', { next: 'check' }),
    node('check', {
      kind: 'branch',
      branches: [
        { id: 'b1', condition: 'composure >= 75', targetNodeId: 'calm', extras: {} },
        { id: 'b2', condition: 'composure <= 74', targetNodeId: 'shaken', extras: {} },
      ],
    }),
    node('calm', { next: null }),
    node('shaken', { next: null }),
  ],
  [{ id: 'composure', type: 'number', default: 100, description: '' }],
);

const noBranchMatches = project(
  [
    node('open', { next: 'check' }),
    node('check', {
      kind: 'branch',
      branches: [{ id: 'b1', condition: 'composure > 200', targetNodeId: 'never', extras: {} }],
    }),
    node('never'),
  ],
  [{ id: 'composure', type: 'number', default: 10, description: '' }],
);

const withSetAndInput = project(
  [
    node('ask', { kind: 'input', expression: 'firstName, playerAge', next: 'combine' }),
    node('combine', { kind: 'set', expression: "fullName = '柚' + firstName", next: 'grow' }),
    node('grow', { kind: 'set', expression: 'playerAge = playerAge + 1', next: 'done' }),
    node('done', { next: null }),
  ],
  [
    { id: 'firstName', type: 'string', default: '', description: '' },
    { id: 'playerAge', type: 'number', default: 0, description: '' },
    { id: 'fullName', type: 'string', default: '', description: '' },
  ],
);

const brokenJump = project([node('only', { next: 'nowhere' })]);

const infiniteLoop = project([
  node('x', { kind: 'set', expression: 'n = n + 1', next: 'x' }),
], [{ id: 'n', type: 'number', default: 0, description: '' }]);

const playthroughs: PlaythroughCase[] = [
  playthrough('線性推進到結束', linear, 'scene', [['advance'], ['advance'], ['advance']]),
  playthrough('選左邊', withChoices, 'scene', [['choose', 'c1'], ['advance']]),
  playthrough('選右邊', withChoices, 'scene', [['choose', 'c2'], ['advance']]),
  playthrough('選了不存在的選項', withChoices, 'scene', [['choose', 'nope']]),
  playthrough('分支走高值', withBranch, 'scene', [['advance']], { composure: 80 }),
  playthrough('分支走低值', withBranch, 'scene', [['advance']], { composure: 10 }),
  playthrough('分支邊界值 74', withBranch, 'scene', [['advance']], { composure: 74 }),
  // 起點是 line 節點，settle 會立刻停下；要 advance 一次才真的走進 branch。
  // 少了這一步，這個案例看起來有測、其實完全沒碰到分支邏輯。
  playthrough('沒有條件成立', noBranchMatches, 'scene', [['advance']]),
  playthrough('輸入與賦值', withSetAndInput, 'scene', [
    ['input', { firstName: '葉', playerAge: '17' }],
    ['advance'],
  ]),
  playthrough('數字型別的輸入不吃前導零', withSetAndInput, 'scene', [
    ['input', { firstName: '00812', playerAge: '25' }],
  ]),
  playthrough('跳轉指向不存在的節點', brokenJump, 'scene', [['advance']]),
  playthrough('無限迴圈會被擋下', infiniteLoop, 'scene', []),
  playthrough('找不到場景', linear, 'nope', []),
];

// ---------------------------------------------------------------- 輸出

mkdirSync(OUT, { recursive: true });

function write(name: string, payload: unknown): string {
  const file = resolve(OUT, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

write('expressions.json', { version: 1, expressions, assignments, inputs });
write('playthroughs.json', { version: 1, playthroughs });

console.log(
  `已寫出 ${OUT}\n` +
    `  運算式 ${expressions.length}（其中解析失敗 ${expressions.filter((c) => c.parseError).length}、` +
    `求值失敗 ${expressions.filter((c) => c.evalError).length}）\n` +
    `  賦值 ${assignments.length}、輸入節點 ${inputs.length}\n` +
    `  整場走訪 ${playthroughs.length}，共 ${playthroughs.reduce((n, p) => n + p.snapshots.length, 0)} 個快照`,
);
