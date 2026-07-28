import { describe, expect, it } from 'vitest';

import { createEmptyProject, createNode, createScene } from '../schema/factory';
import { newId } from '../schema/ids';
import { BUILTIN_FUNCTIONS, evaluate, truthy, type Value } from './evaluate';
import { collectVariables, parseAssignment, parseExpression, parseInputTargets } from './parse';
import { collectProjectVariables, declareMissingVariables } from './variables';

const ctx = (vars: Record<string, Value> = {}) => ({
  variables: new Map(Object.entries(vars)),
  functions: BUILTIN_FUNCTIONS,
});

function run(source: string, vars: Record<string, Value> = {}) {
  const parsed = parseExpression(source);
  if (!parsed.ok) return { error: parsed.error.message };
  const result = evaluate(parsed.value, ctx(vars));
  return result.ok ? { value: result.value } : { error: result.message };
}

describe('典型的分支條件', () => {
  // 實務上絕大多數條件就是數值比較，邊界值最容易寫錯，所以逐一釘住。
  const cases: [string, Record<string, Value>, boolean][] = [
    ['age < 25', { age: 20 }, true],
    ['age < 25', { age: 25 }, false],
    ['age >= 25', { age: 25 }, true],
    ['courage >= 95', { courage: 95 }, true],
    ['courage <= 94', { courage: 94 }, true],
    ['courage >= 75', { courage: 74 }, false],
    ['courage <= 74', { courage: 74 }, true],
    ['courage <= 24', { courage: 30 }, false],
  ];

  for (const [source, vars, expected] of cases) {
    it(`${source}（${JSON.stringify(vars)}）→ ${expected}`, () => {
      expect(run(source, vars)).toEqual({ value: expected });
    });
  }
});

describe('典型的賦值', () => {
  const evalAssign = (source: string, vars: Record<string, Value>) => {
    const parsed = parseAssignment(source);
    if (!parsed.ok) return { error: parsed.error.message };
    const result = evaluate(parsed.value.value, ctx(vars));
    return result.ok ? { target: parsed.value.target, value: result.value } : { error: result.message };
  };

  it('字串相加', () => {
    expect(evalAssign('fullName = lastName + firstName', { lastName: '山', firstName: '田' })).toEqual({
      target: 'fullName',
      value: '山田',
    });
  });

  it('函式呼叫', () => {
    expect(evalAssign('level = Max(age, 25)', { age: 30 })).toEqual({
      target: 'level',
      value: 30,
    });
    expect(evalAssign('level = Max(age, 25)', { age: 18 })).toEqual({
      target: 'level',
      value: 25,
    });
  });

  it('變數複製', () => {
    expect(evalAssign('finalScore = level', { level: 42 })).toEqual({
      target: 'finalScore',
      value: 42,
    });
  });

  it('CalcAge 是預覽用的暫代實作，Unity 端必須提供自己的版本', () => {
    const result = evalAssign('age = CalcAge(birthday, referenceDate)', {
      birthday: '2000-07-24',
      referenceDate: '2026-07-28',
    });
    expect(result).toEqual({ target: 'age', value: 26 });
  });
});

describe('運算式語言', () => {
  it('數字與四則運算', () => {
    expect(run('1 + 2 * 3')).toEqual({ value: 7 });
    expect(run('(1 + 2) * 3')).toEqual({ value: 9 });
    expect(run('7 % 3')).toEqual({ value: 1 });
    expect(run('-5 + 2')).toEqual({ value: -3 });
  });

  it('比較與相等', () => {
    expect(run('3 == 3')).toEqual({ value: true });
    expect(run('"a" != "b"')).toEqual({ value: true });
    expect(run("'x' == 'x'")).toEqual({ value: true });
  });

  it('布林運算與短路', () => {
    expect(run('true && false')).toEqual({ value: false });
    expect(run('flag || other', { flag: true })).toEqual({ value: true });
    // 左邊已決定結果時右邊不求值，因此未定義的變數不會造成錯誤。
    expect(run('false && missing')).toEqual({ value: false });
    expect(run('true || missing')).toEqual({ value: true });
  });

  it('否定', () => {
    expect(run('!flag', { flag: false })).toEqual({ value: true });
    expect(run('!0')).toEqual({ value: true });
  });

  it('真假判定：空字串與 0 為假', () => {
    expect(truthy(0)).toBe(false);
    expect(truthy('')).toBe(false);
    expect(truthy('0')).toBe(true);
    expect(truthy(-1)).toBe(true);
  });
});

describe('錯誤處理（永不拋例外）', () => {
  it('未定義的變數', () => {
    expect(run('courage >= 95').error).toContain('還沒有值');
  });

  it('不存在的函式', () => {
    expect(run('Foo(1)').error).toContain('沒有這個函式');
  });

  it('參數個數不符', () => {
    expect(run('Abs(1, 2)').error).toContain('需要 1 個參數');
  });

  it('型別不合的比較', () => {
    expect(run('name < 5', { name: '山田' }).error).toContain('都必須是數字');
  });

  it('除以零', () => {
    expect(run('1 / 0').error).toBe('除以零');
  });

  it('語法錯誤有位置', () => {
    const parsed = parseExpression('age >= ');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain('突然結束');
  });

  it('未閉合的括號', () => {
    const parsed = parseExpression('Max(1, 2');
    expect(parsed.ok).toBe(false);
  });

  it('空運算式', () => {
    expect(parseExpression('   ').ok).toBe(false);
  });

  it('多餘的內容', () => {
    const parsed = parseExpression('1 2');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain('多餘');
  });
});

describe('賦值解析', () => {
  it('必須以變數名與 = 開頭', () => {
    expect(parseAssignment('1 = 2').ok).toBe(false);
    expect(parseAssignment('age').ok).toBe(false);
  });

  it('= 不會被誤認為比較運算子', () => {
    const parsed = parseAssignment('a = b == c');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.value.kind).toBe('binary');
  });
});

describe('輸入節點', () => {
  it('單一與多個變數名', () => {
    expect(parseInputTargets('birthday')).toEqual({ ok: true, value: ['birthday'] });
    expect(parseInputTargets('lastName, firstName')).toEqual({
      ok: true,
      value: ['lastName', 'firstName'],
    });
  });

  it('拒絕不合法的名稱', () => {
    expect(parseInputTargets('lastName, 1x').ok).toBe(false);
    expect(parseInputTargets('a,,b').ok).toBe(false);
  });
});

describe('變數型別推測', () => {
  const project = (expressions: { set?: string; condition?: string; input?: string }[]) => {
    const p = createEmptyProject('推測', ['zh']);
    const nodes = expressions.map((e) => {
      if (e.set) return createNode({ text: {}, kind: 'set', expression: e.set });
      if (e.input) return createNode({ text: {}, kind: 'input', expression: e.input });
      return createNode({
        text: {},
        kind: 'branch',
        branches: [{ id: newId(), condition: e.condition!, targetNodeId: null, extras: {} }],
      });
    });
    p.scenes = [createScene('唯一', nodes)];
    return p;
  };

  const typesOf = (p: ReturnType<typeof project>) =>
    Object.fromEntries(collectProjectVariables(p).map((v) => [v.id, v.type]));

  it('與數字比較 → number', () => {
    expect(typesOf(project([{ condition: 'age < 25' }]))).toEqual({ age: 'number' });
  });

  it('函式回傳型別決定賦值目標，參數不受影響', () => {
    // 這正是字串比對版本會判錯的地方：birthday 是日期字串而非數字。
    expect(typesOf(project([{ set: 'age = CalcAge(birthday, referenceDate)' }]))).toEqual({
      age: 'number',
      birthday: 'string',
      referenceDate: 'string',
    });
  });

  it('型別會沿著賦值傳播', () => {
    expect(
      typesOf(project([{ set: 'level = Max(base, 25)' }, { set: 'finalScore = level' }])),
    ).toEqual({ base: 'number', level: 'number', finalScore: 'number' });
  });

  it('字串相加 → string', () => {
    expect(typesOf(project([{ set: 'fullName = lastName + firstName' }]))).toMatchObject({
      fullName: 'string',
    });
  });

  it('只被讀取沒被設定的變數會被標示需由遊戲提供', () => {
    const p = project([{ condition: 'courage >= 95' }]);
    const added = declareMissingVariables(p);
    expect(added).toEqual([
      { id: 'courage', type: 'number', default: 0, description: '劇本只讀取不設定，需由遊戲提供' },
    ]);
  });

  it('不覆蓋已存在的宣告', () => {
    const p = project([{ condition: 'courage >= 95' }]);
    p.variables = [{ id: 'courage', type: 'number', default: 50, description: '勇氣值' }];

    expect(declareMissingVariables(p)).toEqual([]);
    expect(p.variables[0]!.default).toBe(50);
  });
});

describe('變數萃取', () => {
  it('找出運算式中所有變數，函式名不算', () => {
    const parsed = parseExpression('Max(age, base) + offset');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect([...collectVariables(parsed.value)].sort()).toEqual(['age', 'base', 'offset']);
    }
  });
});
