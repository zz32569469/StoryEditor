import { useMemo } from 'react';

import { BUILTIN_FUNCTIONS } from '../expr/evaluate';
import { parseAssignment, parseExpression, parseInputTargets } from '../expr/parse';

/**
 * 運算式輸入框。
 *
 * 除了範例佔位文字，還會**當場**顯示語法錯誤 —— 運算式打錯不像台詞，
 * 肉眼看不出來，等到播放時才報錯離出錯的操作太遠。
 */

export type ExpressionKind = 'condition' | 'assignment' | 'input';

const PLACEHOLDER: Record<ExpressionKind, string> = {
  condition: '例：courage >= 95',
  assignment: '例：level = Max(age, 25)',
  input: '例：lastName, firstName',
};

const HINT: Record<ExpressionKind, string> = {
  condition: '成立時跳往右邊指定的節點。可用 > >= < <= == != && || !',
  assignment: '把右邊算出來的值存進左邊的變數。可用 + - * / %，字串用 + 串接',
  input: '要接收玩家輸入的變數名，多個用逗號分隔',
};

function validate(kind: ExpressionKind, value: string): string | null {
  if (!value.trim()) return null; // 空白讓使用者慢慢打，不要一開始就紅
  const result =
    kind === 'condition'
      ? parseExpression(value)
      : kind === 'assignment'
        ? parseAssignment(value)
        : parseInputTargets(value);
  return result.ok ? null : result.error.message;
}

export interface ExpressionFieldProps {
  kind: ExpressionKind;
  value: string;
  onChange: (next: string) => void;
  /** 顯示可用函式清單。條件與賦值才需要。 */
  showFunctions?: boolean;
}

export function ExpressionField({ kind, value, onChange, showFunctions }: ExpressionFieldProps) {
  const error = useMemo(() => validate(kind, value), [kind, value]);
  // 從實際的函式庫產生，之後新增函式不必再改這裡。
  const functions = Object.keys(BUILTIN_FUNCTIONS).join('、');

  return (
    <div className="expr-field">
      <input
        type="text"
        className={error ? 'is-invalid' : ''}
        value={value}
        placeholder={PLACEHOLDER[kind]}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p className="expr-error">{error}</p>
      ) : (
        <p className="expr-hint">
          {HINT[kind]}
          {showFunctions && `；函式：${functions}`}
        </p>
      )}
    </div>
  );
}
