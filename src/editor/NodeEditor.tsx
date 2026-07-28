import { useRef } from 'react';

import { useEditor, useSelectedNode, useSelectedScene } from '../state/store';
import { parseText } from '../tags/parse';
import { ExpressionField } from './ExpressionField';
import { KIND_LABEL, summarizeNode } from './nodeKind';
import { TagToolbar } from './TagToolbar';

/**
 * 顯示轉檔時保留下來的製作欄位。
 *
 * 這些欄位本工具還沒有正式支援，但既然帶進來了就要看得見 ——
 * 藏起來的資料等同於遺失的資料。
 */
function ExtrasList({ entries }: { entries: [string, string][] }) {
  if (entries.length === 0) return null;
  return (
    <div className="field field--stack">
      <span>其他製作欄位（原樣保留，尚未支援編輯）</span>
      <dl className="extras">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 目前選取節點的編輯表單：說話者、立繪、台詞、選項、去向、備註。 */
export function NodeEditor() {
  const project = useEditor((s) => s.project);
  const lang = useEditor((s) => s.lang);
  const {
    setNodeText,
    updateNode,
    updateBranch,
    addChoice,
    updateChoice,
    setChoiceText,
    deleteChoice,
  } = useEditor();
  const scene = useSelectedScene();
  const node = useSelectedNode();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!node || !scene) {
    return <p className="hint">先新增一句台詞。</p>;
  }

  const text = node.text[lang] ?? '';
  const issues = parseText(text, project.tagRegistry).issues;
  const otherNodes = scene.nodes.filter((n) => n.id !== node.id);

  const nodeLabel = (n: (typeof otherNodes)[number], i: number) =>
    `${i + 1}. ${summarizeNode(n, n.text[project.meta.baseLanguage] ?? '').slice(0, 16)}`;

  const extraEntries = Object.entries(node.extras);

  // 流程控制節點沒有台詞與選項，套用對白表單只會顯示一堆不適用的欄位。
  if (node.kind !== 'line') {
    return (
      <div className="form">
        <p className="hint">
          這是<b>{KIND_LABEL[node.kind]}</b>節點，由匯入的劇本表格產生。
          運算式目前只保存不執行。
        </p>

        {(node.kind === 'set' || node.kind === 'input') && (
          <div className="field field--stack">
            <span>{node.kind === 'set' ? '賦值' : '接收輸入的變數'}</span>
            <ExpressionField
              kind={node.kind === 'set' ? 'assignment' : 'input'}
              value={node.expression ?? ''}
              onChange={(next) => updateNode(node.id, { expression: next })}
              showFunctions={node.kind === 'set'}
            />
          </div>
        )}

        {node.kind === 'branch' && (
          <div className="field field--stack">
            <span>分支（由上而下判斷，取第一個成立的）</span>
            {node.branches.map((branch, index) => (
              <div key={branch.id} className="choice-row choice-row--branch">
                <ExpressionField
                  kind="condition"
                  value={branch.condition}
                  onChange={(next) => updateBranch(node.id, branch.id, { condition: next })}
                  showFunctions={index === 0}
                />
                <select
                  value={branch.targetNodeId ?? ''}
                  onChange={(e) =>
                    updateBranch(node.id, branch.id, { targetNodeId: e.target.value || null })
                  }
                >
                  <option value="">（結束）</option>
                  {otherNodes.map((n, i) => (
                    <option key={n.id} value={n.id}>
                      {nodeLabel(n, i)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {node.kind !== 'branch' && node.kind !== 'end' && (
          <label className="field">
            <span>下一句</span>
            <select
              value={node.next ?? ''}
              onChange={(e) => updateNode(node.id, { next: e.target.value || null })}
            >
              <option value="">（本場景結束）</option>
              {otherNodes.map((n, i) => (
                <option key={n.id} value={n.id}>
                  {nodeLabel(n, i)}
                </option>
              ))}
            </select>
          </label>
        )}

        <ExtrasList entries={extraEntries} />
        <p className="node-id">id: {node.id}</p>
      </div>
    );
  }

  return (
    <div className="form">
      <label className="field">
        <span>說話者</span>
        <select
          value={node.speaker ?? ''}
          onChange={(e) => updateNode(node.id, { speaker: e.target.value || undefined })}
        >
          <option value="">（旁白）</option>
          {project.characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name[project.meta.baseLanguage] ?? c.id}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>立繪代號</span>
        <input
          type="text"
          value={node.portrait ?? ''}
          placeholder="例：便服-微笑（美術資產的代號）"
          onChange={(e) => updateNode(node.id, { portrait: e.target.value || undefined })}
        />
      </label>

      <div className="field field--stack">
        <span>
          台詞
          <em className="field-lang">{lang}</em>
        </span>
        <TagToolbar
          registry={project.tagRegistry}
          syntax={project.meta.tagSyntax}
          value={text}
          onChange={(next) => setNodeText(node.id, lang, next)}
          textareaRef={textareaRef}
        />
        <textarea
          ref={textareaRef}
          rows={5}
          value={text}
          placeholder={
            '在這裡輸入台詞。選一段字後按上方按鈕可加特效，例如 {shake}活下來{/shake}\n' +
            '寫 <變數名> 會在播放時代入該變數當下的值'
          }
          onChange={(e) => setNodeText(node.id, lang, e.target.value)}
        />
        {issues.length > 0 && (
          <ul className="issue-list issue-list--inline">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="field field--stack">
        <span>
          選項
          <button type="button" className="link" onClick={() => addChoice(node.id)}>
            + 新增選項
          </button>
        </span>
        {node.choices.length === 0 && <p className="hint">沒有選項時，這一句會直接接到「下一句」。</p>}
        {node.choices.map((choice) => (
          <div key={choice.id} className="choice-row">
            <input
              type="text"
              value={choice.text[lang] ?? ''}
              placeholder="例：「我不是來活下來的。」"
              onChange={(e) => setChoiceText(node.id, choice.id, lang, e.target.value)}
            />
            <select
              value={choice.targetNodeId ?? ''}
              onChange={(e) =>
                updateChoice(node.id, choice.id, { targetNodeId: e.target.value || null })
              }
            >
              <option value="">（結束對話）</option>
              {otherNodes.map((n, i) => (
                <option key={n.id} value={n.id}>
                  {nodeLabel(n, i)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="danger"
              title="刪除選項"
              onClick={() => deleteChoice(node.id, choice.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {node.choices.length === 0 && (
        <label className="field">
          <span>下一句</span>
          <select
            value={node.next ?? ''}
            onChange={(e) => updateNode(node.id, { next: e.target.value || null })}
          >
            <option value="">（本場景結束）</option>
            {otherNodes.map((n, i) => (
              <option key={n.id} value={n.id}>
                {i + 1}. {(n.text[project.meta.baseLanguage] ?? '').slice(0, 14) || '（空白）'}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field field--stack">
        <span>備註（給翻譯者，會匯出到 Excel）</span>
        <textarea
          rows={2}
          value={node.notes}
          placeholder="例：語氣平靜，不要驚悚化。這裡的說明會一起匯出給譯者"
          onChange={(e) => updateNode(node.id, { notes: e.target.value })}
        />
      </label>

      <ExtrasList entries={extraEntries} />

      <p className="node-id">id: {node.id}</p>
    </div>
  );
}
