import { useMemo } from 'react';

import { STAGE_COLUMNS, STAGE_FIELDS } from '../legacy/format';
import type { Stage, StageField } from '../schema/story';
import { isEmptyStage, parseStage } from '../stage/directives';

/** 每一欄的範例寫法（格式見 docs/FORMAT.md §3.5）。 */
const PLACEHOLDER: Record<StageField, string> = {
  background: '例：店內-白天；寫「無」換成全黑',
  position: '例：右（多人站位，之後開放）',
  portraitEffect: '例：淡入 0.4（進退場，之後開放）',
  cg: '例：cg-開幕準備；寫「無」收起',
  screenEffect: '例：睜眼 1.5，震動 0.3 2',
  sfx: '例：門鈴，杯子',
  bgm: '例：早晨的店 2；停止 1',
  attributes: '例：信任+1，幹勁-1',
  items: '例：咖啡豆×2，紙杯',
  unlocks: '例：咖啡機',
  target: '例：新人',
};

export interface StageFieldsProps {
  stage: Stage | undefined;
  onChange: (next: Stage | undefined) => void;
  /** 只顯示這些欄（選項只需要少數幾欄）。 */
  fields?: StageField[];
}

/**
 * 演出欄位編輯：一欄一個輸入框，欄名與劇本表一致，寫錯當場列出。
 * 沒有任何內容時存成 undefined，不在檔案裡留一個空物件。
 */
export function StageFields({ stage, onChange, fields = STAGE_FIELDS }: StageFieldsProps) {
  const issues = useMemo(() => parseStage(stage).issues, [stage]);

  const set = (field: StageField, value: string) => {
    const next: Stage = { ...stage, [field]: value || undefined };
    if (!value) delete next[field];
    onChange(isEmptyStage(next) ? undefined : next);
  };

  return (
    <div className="stage-fields">
      {fields.map((field) => (
        <label key={field} className="field">
          <span>{STAGE_COLUMNS[field][0]}</span>
          <input
            type="text"
            value={stage?.[field] ?? ''}
            placeholder={PLACEHOLDER[field]}
            onChange={(e) => set(field, e.target.value)}
          />
        </label>
      ))}
      {issues.length > 0 && (
        <ul className="issue-list issue-list--inline">
          {issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
