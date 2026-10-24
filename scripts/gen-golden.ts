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
import { FORMAT_VERSION, type Stage, type StoryNode, type StoryProject } from '../src/schema/story';
import { parseStage } from '../src/stage/directives';
import { DEFAULT_TAG_REGISTRY } from '../src/schema/tags';
import { parseText, type ResolvedTag } from '../src/tags/parse';
import { interpolate } from '../src/tags/interpolate';
import { BASE_CHARS_PER_SECOND, buildSchedule } from '../src/preview/schedule';

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
  availableChoices: string[];
  /** 這一步經過的演出，寫成「kind:id」。 */
  cues: string[];
  effects: { name: string; delta: number; variable: string | null; target: string | null }[];
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
    availableChoices: [...state.availableChoices],
    cues: state.cues.map((c) => `${c.kind}:${c.id}`),
    effects: state.effects.map((e) => ({ ...e })),
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

const lockedChoices = project(
  [
    node('ask', {
      choices: [
        { id: 'free', text: { zh: '一直都在' }, targetNodeId: 'end', extras: {} },
        {
          id: 'warm',
          text: { zh: '要夠熟' },
          targetNodeId: 'end',
          condition: 'affection >= 30',
          extras: {},
        },
        { id: 'key', text: { zh: '要有鑰匙' }, targetNodeId: 'end', condition: 'hasKey', extras: {} },
        // 只有空白的條件等同沒有條件 —— 編輯器清空欄位時可能留下空白。
        { id: 'blank', text: { zh: '空白條件' }, targetNodeId: 'end', condition: '  ', extras: {} },
      ],
    }),
    node('end', { kind: 'end' }),
  ],
  [
    { id: 'affection', type: 'number', default: 0, description: '' },
    { id: 'hasKey', type: 'bool', default: false, description: '' },
  ],
);

const allLocked = project(
  [
    node('ask', {
      choices: [
        { id: 'a', text: { zh: 'A' }, targetNodeId: null, condition: 'affection > 50', extras: {} },
        { id: 'b', text: { zh: 'B' }, targetNodeId: null, condition: 'affection > 80', extras: {} },
      ],
    }),
  ],
  [{ id: 'affection', type: 'number', default: 0, description: '' }],
);

// 條件在抵達選項時才判斷：先經過 set 再到選項，看到的必須是改過之後的值。
const unlockAfterSet = project(
  [
    node('open', { next: 'gain' }),
    node('gain', { kind: 'set', expression: 'affection = affection + 40', next: 'ask' }),
    node('ask', {
      choices: [
        { id: 'plain', text: { zh: '普通' }, targetNodeId: null, extras: {} },
        { id: 'warm', text: { zh: '熟了' }, targetNodeId: null, condition: 'affection >= 30', extras: {} },
      ],
    }),
  ],
  [{ id: 'affection', type: 'number', default: 0, description: '' }],
);

const brokenUnlock = project([
  node('ask', {
    choices: [
      { id: 'ok', text: { zh: '正常' }, targetNodeId: null, extras: {} },
      { id: 'bad', text: { zh: '壞掉' }, targetNodeId: null, condition: 'affection >=', extras: {} },
    ],
  }),
]);

const undefinedUnlock = project([
  node('ask', {
    choices: [
      { id: 'ok', text: { zh: '正常' }, targetNodeId: null, extras: {} },
      { id: 'typo', text: { zh: '打錯字' }, targetNodeId: null, condition: 'afection >= 1', extras: {} },
    ],
  }),
]);

// 演出欄位：進場時的背景／效果、控制列上的音效、分支與選項自己的屬性變化。
// 「心情」是文字變數不能加減、「未知」不在屬性清單裡 —— 兩者都只記 effect、不改變數
const withStage = project(
  [
    node('open', {
      next: 'calc',
      stage: { background: '店內-白天', screenEffect: '睜眼效果', attributes: '信任+1' },
    }),
    node('calc', { kind: 'set', expression: 'score = trust * 10', next: 'gate', stage: { sfx: '門鈴' } }),
    node('gate', {
      kind: 'branch',
      branches: [
        { id: 'b1', condition: 'trust >= 1', targetNodeId: 'ask', stage: { attributes: '幹勁+2' }, extras: {} },
        { id: 'b2', condition: 'trust < 1', targetNodeId: 'ask', extras: {} },
      ],
    }),
    node('ask', {
      choices: [
        {
          id: 'c1',
          text: { zh: '先試做拿鐵' },
          targetNodeId: 'end',
          stage: { attributes: '信任-1，未知+1，心情+1', target: '新人', sfx: '杯子' },
          extras: {},
        },
        { id: 'c2', text: { zh: '先整理吧台' }, targetNodeId: 'end', extras: {} },
      ],
    }),
    node('end', { kind: 'end', stage: { bgm: '停止 2' } }),
  ],
  [
    { id: 'trust', type: 'number', default: 0, description: '', label: '信任' },
    { id: 'motivation', type: 'number', default: 0, description: '', label: '幹勁' },
    { id: 'mood', type: 'string', default: '普通', description: '', label: '心情' },
    { id: 'score', type: 'number', default: 0, description: '' },
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
  playthrough('解鎖條件不成立的選項不出現', lockedChoices, 'scene', [['choose', 'free']]),
  playthrough('解鎖條件成立的選項出現並可選', lockedChoices, 'scene', [['choose', 'warm']], {
    affection: 30,
    hasKey: true,
  }),
  playthrough('選了被鎖住的選項', lockedChoices, 'scene', [['choose', 'key']], { affection: 99 }),
  playthrough('所有選項都被鎖住', allLocked, 'scene', [], { affection: 10 }),
  playthrough('解鎖條件在抵達時才判斷', unlockAfterSet, 'scene', [['advance'], ['choose', 'warm']]),
  playthrough('解鎖條件語法錯誤', brokenUnlock, 'scene', []),
  playthrough('解鎖條件用到未定義的變數', undefinedUnlock, 'scene', []),
  playthrough('演出：進場、控制列、分支與選項的屬性變化', withStage, 'scene', [['advance'], ['choose', 'c1']]),
  playthrough('演出：沒有演出的選項不留 cue', withStage, 'scene', [['advance'], ['choose', 'c2']]),
  playthrough('跳轉指向不存在的節點', brokenJump, 'scene', [['advance']]),
  playthrough('無限迴圈會被擋下', infiniteLoop, 'scene', []),
  playthrough('找不到場景', linear, 'nope', []),
];

// ---------------------------------------------------------------- 特效標記

interface EncodedTag {
  name: string;
  params: Record<string, { kind: 'number' | 'string' | 'bool'; display: string }>;
}

interface TagCase {
  input: string;
  plain: string;
  chars: { char: string; effects: EncodedTag[]; before: EncodedTag[] }[];
  trailing: EncodedTag[];
  issues: { message: string; index: number }[];
}

function encodeTag(tag: ResolvedTag): EncodedTag {
  const params: EncodedTag['params'] = {};
  for (const key of Object.keys(tag.params).sort()) {
    const value = tag.params[key]!;
    const kind = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'bool' : 'string';
    params[key] = { kind, display: String(value) };
  }
  return { name: tag.name, params };
}

function tagCase(input: string): TagCase {
  const parsed = parseText(input, DEFAULT_TAG_REGISTRY);
  return {
    input,
    plain: parsed.plain,
    chars: parsed.chars.map((c) => ({
      char: c.char,
      effects: c.effects.map(encodeTag),
      before: c.before.map(encodeTag),
    })),
    trailing: parsed.trailing.map(encodeTag),
    issues: parsed.issues.map((issue) => ({ message: issue.message, index: issue.index })),
  };
}

const tags: TagCase[] = [
  tagCase('沒有標記的純文字'),
  tagCase(''),

  // 成對與嵌套
  tagCase('[b]粗[/b]'),
  tagCase('[b]粗[i]又斜[/i][/b]'),
  tagCase('前[shake amp=3 freq=10]抖[/shake]後'),

  // 簡寫與百分比 —— 實際劇本大量使用的形式
  tagCase('{i}{color=#606060}（旁白）{/color}{/i}'),
  tagCase('{size=130%}大{/size}'),
  tagCase('[color=#f00]紅[/color]'),
  tagCase('[size=0.5]小[/size]'),
  tagCase('[color value=#00ff00]綠[/color]'),

  // 單點標籤
  tagCase('停[wait=0.5]頓'),
  tagCase('[speed=0.5]慢慢說[/speed]'),
  tagCase('結尾之後[wait=1]'),
  tagCase('[sfx=door]開門'),

  // 引號與空白
  tagCase('[font="Noto Serif TC"]字型[/font]'),
  tagCase('[font="含\\"引號"]x[/font]'),

  // 轉義
  tagCase('\\[不是標記\\]'),
  tagCase('\\{也不是\\}'),
  tagCase('反斜線 \\\\ 本身'),

  // 尖括號不是標記，原樣保留（TMP 會自己處理）
  tagCase('<i>這是變數插值的括號</i>'),
  tagCase('<lastName>，對吧？'),

  // 各種壞掉的寫法
  tagCase('[notatag]x'),
  tagCase('[b]沒有結束'),
  tagCase('多餘的[/b]'),
  tagCase('[b]名稱不符[/i]'),
  tagCase('[b]括號不符{/b}'),
  tagCase('[wait=1]不需要結束[/wait]'),
  tagCase('[color]缺少色碼[/color]'),
  tagCase('[color=不是色碼]x[/color]'),
  tagCase('[size=abc]x[/size]'),
  tagCase('[b bad=1]x[/b]'),
  tagCase('[b=1]x[/b]'),
  tagCase('[未關閉'),
  tagCase('['),
];

// ---------------------------------------------------------------- 逐字排程

interface ScheduleCase {
  input: string;
  /** 省略時用預設值；有給就兩邊都照這組參數算。 */
  options?: { charsPerSecond: number; sentencePause: number };
  /** 每個字出現的時刻，以 String(number) 表示以求逐位一致。 */
  times: string[];
  total: string;
}

function scheduleCase(input: string, options?: ScheduleCase['options']): ScheduleCase {
  const parsed = parseText(input, DEFAULT_TAG_REGISTRY);
  const schedule = buildSchedule(parsed.chars, options);
  return {
    input,
    ...(options ? { options } : {}),
    times: schedule.times.map(String),
    total: String(schedule.total),
  };
}

const UI25 = { charsPerSecond: 1 / 0.035, sentencePause: 0.15 };

const schedules: ScheduleCase[] = [
  scheduleCase(''),
  scheduleCase('一般速度'),
  scheduleCase('停[wait=0.5]頓'),
  scheduleCase('[wait=2]開頭就等'),
  scheduleCase('結尾等[wait=1]'),
  scheduleCase('[speed=0.5]慢[/speed]快'),
  scheduleCase('[speed=2]快[/speed]一般'),
  scheduleCase('[speed=0.01]夾到下限[/speed]'),
  scheduleCase('[speed=2][speed=0.5]內層優先[/speed][/speed]'),
  scheduleCase('[b]粗體不影響速度[/b]'),
  scheduleCase('混[wait=0.25][speed=0.5]合[/speed]用'),

  // 遊戲的閱讀規則（原型 UI25）：每字 35ms、句末標點之後停 150ms
  scheduleCase('你好。今天！走吧', UI25),
  scheduleCase('真的？好……那走吧?!', UI25),
  scheduleCase('結尾的句號不會多等。', UI25),
  scheduleCase('停。[wait=0.5]頓', UI25),
  scheduleCase('[speed=0.5]慢。[/speed]快', UI25),
  scheduleCase('沒有句末標點', UI25),
  // sentencePause 為 0 時與預設節奏完全相同
  scheduleCase('你好。今天！', { charsPerSecond: BASE_CHARS_PER_SECOND, sentencePause: 0 }),
];

// ---------------------------------------------------------------- 變數插值

interface InterpolationCase {
  input: string;
  variables: Record<string, string>;
  output: string;
  missing: string[];
}

function interpolationCase(input: string, variables: Record<string, string>): InterpolationCase {
  const result = interpolate(input, (name) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : undefined,
  );
  return { input, variables, output: result.text, missing: result.missing };
}

const NAMES = { lastName: '柚', firstName: '葉', age: '17' };

const interpolations: InterpolationCase[] = [
  interpolationCase('沒有插值的句子', {}),
  interpolationCase('<lastName>，對吧？', NAMES),
  interpolationCase('<lastName><firstName> 今年 <age> 歲。', NAMES),
  interpolationCase('<missing> 找不到就原樣保留', NAMES),
  interpolationCase('<lastName> 與 <missing> 混在一起', NAMES),

  // 玩家輸入的值不能變成 TMP 標記
  interpolationCase('<name>，對吧？', { name: '<size=500%>王' }),
  interpolationCase('<name>', { name: '<b>粗</b>' }),
  interpolationCase('<name>', { name: '<a<b<c' }),

  // 方括號與大括號刻意保留 —— 值裡放標記是既有能力
  interpolationCase('請注意：<em>', { em: '[b]很重要[/b]' }),
  interpolationCase('<v>', { v: '{i}斜{/i}' }),

  // 尖括號但不是合法識別字的，不算插值
  interpolationCase('<1bad> 與 </close> 與 <with-dash>', NAMES),
  interpolationCase('<color=#f00> 帶等號的不是插值', NAMES),
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
// ---------------------------------------------------------------- 演出欄位

interface DirectiveCase {
  stage: Stage;
  /** 這一列的「立繪」欄（node.portrait）。 */
  portrait?: string;
  parsed: ReturnType<typeof parseStage>;
}

const directiveCase = (stage: Stage, portrait?: string): DirectiveCase =>
  portrait === undefined ? { stage, parsed: parseStage(stage) } : { stage, portrait, parsed: parseStage(stage, portrait) };

const directives: DirectiveCase[] = [
  directiveCase({}),
  directiveCase({ background: '店內-白天' }),
  directiveCase({ background: '無', cg: 'cg-開幕準備' }),
  directiveCase({ cg: '無' }),
  directiveCase({ background: '兩個 代號' }),
  directiveCase({ screenEffect: '睜眼效果' }),
  directiveCase({ screenEffect: '睜眼 1.5，震動 0.2 2，閃白，黑幕' }),
  directiveCase({ screenEffect: '淡出 1, 淡入 0.25 ，溶接 0.8，閉眼' }),
  directiveCase({ screenEffect: 'OpenNameInput，OpenBirthdayInput' }),
  directiveCase({ screenEffect: '轉圈，淡入 1 2，震動 快，淡出 0.4' }),
  directiveCase({ sfx: '門鈴，杯子, 腳步聲' }),
  directiveCase({ bgm: '早晨的店' }),
  directiveCase({ bgm: '早晨的店 2.5' }),
  directiveCase({ bgm: '停止 1' }),
  directiveCase({ bgm: '早晨 慢 一點' }),
  directiveCase({ attributes: '信任+1，幹勁-1' }),
  directiveCase({ attributes: ' 親切度EXP + 3 , 幹勁－2，信任＋1 ' }),
  directiveCase({ attributes: '信任1，幹勁+' }),
  directiveCase({ items: '咖啡豆×2，紙杯，牛奶x3，糖*1' }),
  directiveCase({ items: '咖啡豆×，兩 包' }),
  directiveCase({ unlocks: '咖啡機，收銀台', target: '新人' }),
  directiveCase({
    background: '店門口',
    cg: '無',
    screenEffect: '淡入 1',
    sfx: '門鈴',
    bgm: '早晨的店 2',
    attributes: '信任+1',
    items: '紙杯',
    unlocks: '吧台',
    target: '店長',
  }),
  // 立繪、位置、立繪效果
  directiveCase({}, '店長-微笑'),
  directiveCase({ position: '左', portraitEffect: '淡入' }, '店長-微笑'),
  directiveCase({ position: '熟客：右，店長:左', portraitEffect: '熟客：右滑入 0.5，左滑出' }, '熟客：熟客-普通'),
  directiveCase({ portraitEffect: '淡出 1' }, '無'),
  directiveCase({}, '熟客：無，新人-開心'),
  directiveCase({ position: '上，熟客：中間', portraitEffect: '轉圈，淡入 慢，左滑入 0.2 1' }, '兩個 代號'),
  directiveCase({ position: '：左，熟客：', portraitEffect: '熟客：' }, '：微笑'),
];

write('playthroughs.json', { version: 1, playthroughs });
write('directives.json', { version: 1, directives });
write('tags.json', { version: 1, registry: DEFAULT_TAG_REGISTRY, tags });
write('schedules.json', { version: 1, baseCharsPerSecond: BASE_CHARS_PER_SECOND, schedules });
write('interpolations.json', { version: 1, interpolations });

console.log(
  `已寫出 ${OUT}\n` +
    `  運算式 ${expressions.length}（其中解析失敗 ${expressions.filter((c) => c.parseError).length}、` +
    `求值失敗 ${expressions.filter((c) => c.evalError).length}）\n` +
    `  賦值 ${assignments.length}、輸入節點 ${inputs.length}\n` +
    `  演出欄位 ${directives.length}\n` +
    `  整場走訪 ${playthroughs.length}，共 ${playthroughs.reduce((n, p) => n + p.snapshots.length, 0)} 個快照\n` +
    `  特效標記 ${tags.length}（其中有問題的 ${tags.filter((t) => t.issues.length > 0).length} 個）
` +
    `  逐字排程 ${schedules.length}
` +
    `  變數插值 ${interpolations.length}`,
);
