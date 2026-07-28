import { useEffect, useState } from 'react';

import type { StoryNode, StoryProject } from '../schema/story';
import { useEditor, useSelectedNode, useSelectedScene } from '../state/store';
import { parseText } from '../tags/parse';
import { KIND_LABEL } from '../editor/nodeKind';
import { PlayMode } from './PlayMode';
import { RichText } from './RichText';

/**
 * 台詞畫面。
 *
 * 這是使用者判斷「效果對不對」的地方，因此它直接讀 store 的專案資料 ——
 * 右邊面板一改，這裡立刻重算，中間沒有需要手動同步的暫存狀態。
 * 點選項或按繼續會直接切換選取的節點，等於可以走過一遍劇情。
 */

function textOf(record: Record<string, string>, lang: string, base: string): string {
  return record[lang] ?? record[base] ?? '';
}

function usesFallback(record: Record<string, string>, lang: string): boolean {
  return !(lang in record) || record[lang] === '';
}

function speakerName(project: StoryProject, node: StoryNode, lang: string): string {
  if (!node.speaker) return '';
  const character = project.characters.find((c) => c.id === node.speaker);
  if (!character) return node.speaker;
  return textOf(character.name, lang, project.meta.baseLanguage) || character.id;
}

export function DialogueStage() {
  const project = useEditor((s) => s.project);
  const lang = useEditor((s) => s.lang);
  const selectNode = useEditor((s) => s.selectNode);
  const scene = useSelectedScene();
  const node = useSelectedNode();

  const [playToken, setPlayToken] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [finished, setFinished] = useState(false);
  const [playing, setPlaying] = useState(false);

  // 換節點時自動重播，這樣走劇情就像實際遊玩。
  useEffect(() => {
    setPlayToken((n) => n + 1);
    setFinished(false);
  }, [node?.id, lang]);

  if (playing && scene) {
    return <PlayMode project={project} scene={scene} lang={lang} onExit={() => setPlaying(false)} />;
  }

  if (!node) {
    return (
      <div className="stage stage--empty">
        <p>還沒有任何台詞。在右側按「新增台詞」開始。</p>
      </div>
    );
  }

  const base = project.meta.baseLanguage;
  const raw = textOf(node.text, lang, base);

  // 流程控制節點不是對白，畫成對話框只會讓人以為台詞不見了。
  if (node.kind !== 'line') {
    return (
      <div className="stage">
        <div className="stage-controls">
          <button type="button" className="primary" onClick={() => setPlaying(true)}>
            ▶ 從頭播放
          </button>
        </div>
        <div className="stage-screen stage-screen--system">
          <div className="system-node">
            <div className="system-node-kind">{KIND_LABEL[node.kind]}</div>
            {node.expression && <code className="system-node-expr">{node.expression}</code>}

            {node.kind === 'branch' && (
              <ul className="system-node-branches">
                {node.branches.map((branch) => (
                  <li key={branch.id}>
                    <code>{branch.condition}</code>
                    <button
                      type="button"
                      disabled={!branch.targetNodeId}
                      onClick={() => branch.targetNodeId && selectNode(branch.targetNodeId)}
                    >
                      前往 ▸
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {node.kind !== 'branch' && node.next && (
              <button type="button" onClick={() => selectNode(node.next!)}>
                繼續 ▸
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          這是流程控制節點，不會顯示給玩家。條件與運算式目前只保存不執行 —— 待 M3 加上編輯與求值。
        </p>
      </div>
    );
  }

  const issues = parseText(raw, project.tagRegistry).issues;
  const fallback = usesFallback(node.text, lang);
  const nextNode = node.next
    ? scene?.nodes.find((n) => n.id === node.next)
    : undefined;

  return (
    <div className="stage">
      <div className="stage-screen">
        {node.portrait && (
          <div className="stage-portrait">
            <span>{node.portrait}</span>
          </div>
        )}

        <div className="dialogue-box">
          {speakerName(project, node, lang) && (
            <div className="dialogue-speaker">{speakerName(project, node, lang)}</div>
          )}

          <div className="dialogue-text">
            {raw ? (
              <RichText
                text={raw}
                registry={project.tagRegistry}
                animate={animate}
                playToken={playToken}
                onFinished={() => setFinished(true)}
              />
            ) : (
              <span className="dialogue-placeholder">（這一句還沒有內容）</span>
            )}
          </div>

          {node.choices.length > 0 ? (
            <ul className="dialogue-choices">
              {node.choices.map((choice) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    disabled={!choice.targetNodeId}
                    onClick={() => choice.targetNodeId && selectNode(choice.targetNodeId)}
                    title={choice.targetNodeId ? '跳到這個選項的目標' : '這個選項還沒設定目標'}
                  >
                    <RichText
                      text={textOf(choice.text, lang, base)}
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
              {nextNode ? (
                <button type="button" onClick={() => selectNode(nextNode.id)}>
                  繼續 ▸
                </button>
              ) : (
                <span className="dialogue-end">▪ 本場景結束</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="stage-controls">
        <button type="button" className="primary" onClick={() => setPlaying(true)}>
          ▶ 從頭播放
        </button>
        <button type="button" onClick={() => setPlayToken((n) => n + 1)} disabled={!animate}>
          ↺ 重播這句
        </button>
        <label className="checkbox">
          <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
          逐字播放
        </label>
        <span className="stage-status">
          {animate && !finished && raw ? '播放中…' : ''}
        </span>

        {fallback && lang !== base && (
          <span className="badge badge--warn">尚未翻譯，顯示 {base}</span>
        )}
      </div>

      {issues.length > 0 && (
        <ul className="issue-list">
          {issues.map((issue, i) => (
            <li key={i}>標記錯誤（第 {issue.index + 1} 字）：{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
