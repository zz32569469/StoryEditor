import { useMemo, useState } from 'react';

import type { Value } from '../expr/evaluate';
import type { Scene, StoryProject } from '../schema/story';
import { advance, choose, currentNode, startScene, submitInput, type PlayerState } from '../runtime/player';
import { interpolate } from '../tags/interpolate';
import { RichText } from './RichText';

/**
 * 從場景開頭實際跑一遍劇情。
 *
 * 與逐節點的編輯預覽不同：這裡會真的求值條件、套用賦值、依選項跳轉，
 * 用來回答「這條分支到底走不走得到」。變數面板可以當場改值試不同路徑。
 */

function textOf(record: Record<string, string>, lang: string, base: string): string {
  return record[lang] ?? record[base] ?? '';
}

export interface PlayModeProps {
  project: StoryProject;
  scene: Scene;
  lang: string;
  onExit: () => void;
}

export function PlayMode({ project, scene, lang, onExit }: PlayModeProps) {
  const [state, setState] = useState<PlayerState>(() => startScene(project, scene.id));
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [showVariables, setShowVariables] = useState(false);

  const base = project.meta.baseLanguage;
  const node = currentNode(project, state);

  /** 播放時把 `<age>` 這類插值換成當下的變數值。 */
  const resolveText = (record: Record<string, string>): string =>
    interpolate(textOf(record, lang, base), (name) => {
      const value = state.variables.get(name);
      return value === undefined ? undefined : String(value);
    }).text;
  const speaker = node?.speaker
    ? project.characters.find((c) => c.id === node.speaker)
    : undefined;

  const restart = () => {
    setState(startScene(project, scene.id));
    setInputs({});
  };

  /** 讓使用者當場改變數，測試不同分支。 */
  const setVariable = (id: string, raw: string) => {
    setState((previous) => {
      const variables = new Map(previous.variables);
      const declared = project.variables.find((v) => v.id === id);
      let value: Value = raw;
      if (declared?.type === 'number') value = Number(raw) || 0;
      else if (declared?.type === 'bool') value = raw === 'true';
      variables.set(id, value);
      return { ...previous, variables };
    });
  };

  const variableRows = useMemo(
    () =>
      [...new Set([...project.variables.map((v) => v.id), ...state.variables.keys()])].sort(),
    [project.variables, state.variables],
  );

  return (
    <div className="stage">
      <div className="play-bar">
        <strong>▶ 播放中</strong>
        <span className="play-scene">{scene.name}</span>
        <button type="button" onClick={restart}>
          ↺ 重新開始
        </button>
        <button type="button" onClick={() => setShowVariables((v) => !v)}>
          變數 {showVariables ? '▲' : '▼'}
        </button>
        <button type="button" onClick={onExit}>
          離開播放
        </button>
      </div>

      {showVariables && (
        <div className="variable-panel">
          {variableRows.length === 0 && <p className="hint">這個專案沒有變數。</p>}
          {variableRows.map((id) => {
            const declared = project.variables.find((v) => v.id === id);
            const value = state.variables.get(id);
            return (
              <label key={id} className="variable-row">
                <span title={declared?.description}>
                  {id}
                  {declared?.description ? ' *' : ''}
                </span>
                <input
                  type="text"
                  value={value === undefined ? '' : String(value)}
                  onChange={(e) => setVariable(id, e.target.value)}
                />
              </label>
            );
          })}
          <p className="hint">標記 * 的變數劇本只讀不寫，實際遊戲中由程式提供。改這裡可以試不同分支。</p>
        </div>
      )}

      <div className="stage-screen">
        {state.status === 'error' ? (
          <div className="play-error">
            <div className="play-error-title">播放中斷</div>
            <p>{state.error}</p>
            <p className="hint">已經走過 {state.visited.length} 個節點。</p>
          </div>
        ) : state.status === 'ended' ? (
          <div className="play-ended">
            <p>▪ 劇情結束</p>
            <p className="hint">走過 {state.visited.length} 個節點。</p>
            <button type="button" onClick={restart}>
              ↺ 再跑一次
            </button>
          </div>
        ) : state.status === 'input' ? (
          <div className="dialogue-box">
            <div className="dialogue-speaker">請輸入</div>
            {state.pendingInputs.map((name) => (
              <label key={name} className="field">
                <span>{name}</span>
                <input
                  type="text"
                  value={inputs[name] ?? ''}
                  placeholder={
                    project.variables.find((v) => v.id === name)?.type === 'number'
                      ? '輸入數字'
                      : '輸入文字（看起來像數字的會自動轉成數字）'
                  }
                  onChange={(e) => setInputs((prev) => ({ ...prev, [name]: e.target.value }))}
                />
              </label>
            ))}
            <div className="dialogue-advance">
              <button
                type="button"
                onClick={() => {
                  setState(submitInput(project, state, inputs));
                  setInputs({});
                }}
              >
                確定 ▸
              </button>
            </div>
          </div>
        ) : (
          <div className="dialogue-box">
            {speaker && (
              <div className="dialogue-speaker">{textOf(speaker.name, lang, base) || speaker.id}</div>
            )}

            <div className="dialogue-text">
              {node && textOf(node.text, lang, base) ? (
                <RichText
                  text={resolveText(node.text)}
                  registry={project.tagRegistry}
                  animate={false}
                  playToken={0}
                />
              ) : (
                <span className="dialogue-placeholder">
                  {node?.choices.length ? '' : '（這一句沒有內容）'}
                </span>
              )}
            </div>

            {state.status === 'choices' && node ? (
              <ul className="dialogue-choices">
                {node.choices.map((choice) => (
                  <li key={choice.id}>
                    <button type="button" onClick={() => setState(choose(project, state, choice.id))}>
                      <RichText
                        text={resolveText(choice.text)}
                        registry={project.tagRegistry}
                        animate={false}
                        playToken={0}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="dialogue-advance">
                <button type="button" onClick={() => setState(advance(project, state))}>
                  繼續 ▸
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
