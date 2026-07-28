import { useMemo } from 'react';

import { collectProjectVariables } from '../expr/variables';
import type { VariableType } from '../schema/story';
import { useEditor } from '../state/store';

/**
 * 變數管理。
 *
 * 匯入劇本時變數是從運算式自動萃取出來的，使用者需要能在這裡看到全貌 ——
 * 尤其是「哪些變數劇本只讀不寫」，那些必須由遊戲在執行時餵值，
 * 不設定的話播放到條件分支就會停住。
 */

const TYPE_LABEL: Record<VariableType, string> = {
  number: '數字',
  string: '字串',
  bool: '布林',
};

function parseDefault(raw: string, type: VariableType): number | string | boolean {
  if (type === 'number') return Number(raw) || 0;
  if (type === 'bool') return raw === 'true';
  return raw;
}

export function VariablePanel() {
  const project = useEditor((s) => s.project);
  const { addVariable, updateVariable, deleteVariable } = useEditor();

  // 用量分析告訴我們哪些變數只被讀取 —— 這些就是遊戲要提供的。
  const usage = useMemo(
    () => new Map(collectProjectVariables(project).map((u) => [u.id, u])),
    [project],
  );

  const external = project.variables.filter((v) => usage.get(v.id)?.assigned === false);

  return (
    <div className="panel-section">
      {project.variables.length === 0 ? (
        <p className="hint">
          這個專案沒有變數。匯入劇本時會自動從條件與賦值中萃取；也可以在這裡手動新增。
        </p>
      ) : (
        <>
          {external.length > 0 && (
            <p className="callout callout--warn">
              有 {external.length} 個變數劇本只讀取、從不設定
              （{external.map((v) => v.id).join('、')}）—— 這些必須由遊戲在執行時提供初始值。
              下方設定的預設值只在編輯器播放時生效。
            </p>
          )}

          <div className="variable-table">
            <div className="variable-head">
              <span>名稱</span>
              <span>型別</span>
              <span>預設值</span>
              <span>說明</span>
              <span />
            </div>

            {project.variables.map((variable) => {
              const info = usage.get(variable.id);
              return (
                <div key={variable.id} className="variable-item">
                  <input
                    type="text"
                    value={variable.id}
                    placeholder="例：courage"
                    title="改名會同步更新條件式、賦值與台詞裡的 <插值>"
                    onChange={(e) => updateVariable(variable.id, { id: e.target.value })}
                  />
                  <select
                    value={variable.type}
                    onChange={(e) => {
                      const type = e.target.value as VariableType;
                      updateVariable(variable.id, {
                        type,
                        default: parseDefault(String(variable.default), type),
                      });
                    }}
                  >
                    {(Object.keys(TYPE_LABEL) as VariableType[]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={String(variable.default)}
                    placeholder={
                      variable.type === 'number'
                        ? '例：0'
                        : variable.type === 'bool'
                          ? 'true 或 false'
                          : '例：2000-07-24'
                    }
                    onChange={(e) =>
                      updateVariable(variable.id, {
                        default: parseDefault(e.target.value, variable.type),
                      })
                    }
                  />
                  <input
                    type="text"
                    value={variable.description}
                    placeholder={info?.assigned === false ? '由遊戲提供' : '這個變數代表什麼'}
                    onChange={(e) => updateVariable(variable.id, { description: e.target.value })}
                  />
                  <button
                    type="button"
                    className="danger"
                    title="刪除變數"
                    onClick={() => {
                      if (
                        confirm(
                          `刪除變數「${variable.id}」？\n` +
                            '劇本裡引用它的條件與台詞不會被改動，之後播放到那裡會報錯。',
                        )
                      ) {
                        deleteVariable(variable.id);
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      <button type="button" onClick={addVariable}>
        + 新增變數
      </button>

      <p className="hint">
        在台詞中寫 <code>&lt;變數名&gt;</code> 就會在播放時代入當下的值。
        條件與賦值請在對應的節點上編輯（劇情分頁選到條件分支或賦值節點）。
      </p>
    </div>
  );
}
