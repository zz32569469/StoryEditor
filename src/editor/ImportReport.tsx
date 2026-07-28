import { useMemo, useState } from 'react';

import { parseCellKey } from '../schema/keys';
import type { StoryProject } from '../schema/story';
import { stripTags } from '../tags/parse';
import { summarize, type CellChange, type MergeReport } from '../sync/merge';

/**
 * 匯入報告。
 *
 * 套用前一律先給人看 —— 這是「不靜默覆蓋使用者內容」這條原則的執行面。
 * 預設值刻意保守：只有 `applied`（僅 Excel 改過）預先勾選，衝突與壞掉的標記
 * 都預設不套用，要由人主動決定。
 */

function describeCell(project: StoryProject, cellKey: string): string {
  const ref = parseCellKey(cellKey);
  if (!ref) return cellKey;

  const langLabel = ref.lang ? ` · ${ref.lang}` : '';
  if (ref.ownerKind === 'character') {
    const character = project.characters.find((c) => c.id === ref.ownerId);
    return `角色「${character?.id ?? ref.ownerId}」的名稱${langLabel}`;
  }

  for (const scene of project.scenes) {
    for (const [index, node] of scene.nodes.entries()) {
      if (ref.ownerKind === 'node' && node.id === ref.ownerId) {
        const field = ref.field === 'notes' ? '備註' : '台詞';
        return `${scene.name} 第 ${index + 1} 句的${field}${langLabel}`;
      }
      const choiceIndex = node.choices.findIndex((c) => c.id === ref.ownerId);
      if (ref.ownerKind === 'choice' && choiceIndex >= 0) {
        return `${scene.name} 第 ${index + 1} 句的選項 ${choiceIndex + 1}${langLabel}`;
      }
    }
  }
  return cellKey;
}

const STATUS_LABEL = {
  applied: '只有 Excel 改過',
  conflict: '兩邊都改過',
  invalid: '標記語法有問題',
  unchanged: '未變更',
} as const;

export interface ImportReportProps {
  project: StoryProject;
  report: MergeReport;
  problems: string[];
  onCancel: () => void;
  onApply: (decisions: Record<string, boolean>) => void;
  initialDecisions: Record<string, boolean>;
}

export function ImportReport({
  project,
  report,
  problems,
  onCancel,
  onApply,
  initialDecisions,
}: ImportReportProps) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const counts = useMemo(() => summarize(report), [report]);

  const actionable = report.changes.filter((c) => c.status !== 'unchanged');
  const acceptedCount = actionable.filter((c) => decisions[c.cellKey]).length;

  const setAll = (status: CellChange['status'], value: boolean) =>
    setDecisions((prev) => {
      const next = { ...prev };
      for (const change of actionable) {
        if (change.status === status) next[change.cellKey] = value;
      }
      return next;
    });

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>匯入報告</h2>

        {report.noSnapshot && (
          <p className="callout callout--warn">
            找不到上次匯出的快照，無法分辨是哪一邊改的，因此所有差異都列為衝突。
            請逐項確認後再套用。
          </p>
        )}

        {problems.length > 0 && (
          <ul className="callout callout--error">
            {problems.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}

        <div className="report-summary">
          <span>只有 Excel 改過 <b>{counts.applied}</b></span>
          <span>兩邊都改過 <b>{counts.conflict}</b></span>
          <span>標記有問題 <b>{counts.invalid}</b></span>
          <span>未變更 <b>{counts.unchanged}</b></span>
        </div>

        {(report.unknownRows.length > 0 || report.missingRows.length > 0 || report.readonlyEdits.length > 0) && (
          <ul className="callout">
            {report.unknownRows.length > 0 && (
              <li>Excel 中有 {report.unknownRows.length} 列在專案裡找不到對應，已略過（不會自動新增）。</li>
            )}
            {report.missingRows.length > 0 && (
              <li>專案中有 {report.missingRows.length} 列不在 Excel 裡，已保留（不會自動刪除）。</li>
            )}
            {report.readonlyEdits.length > 0 && (
              <li>
                有 {report.readonlyEdits.length} 個唯讀欄被改動（
                {[...new Set(report.readonlyEdits.map((e) => e.column))].join('、')}
                ），已忽略。
              </li>
            )}
          </ul>
        )}

        {actionable.length === 0 ? (
          <p className="hint">沒有需要決定的變更。</p>
        ) : (
          <>
            <div className="report-actions">
              <button type="button" onClick={() => setAll('applied', true)}>
                全選「只有 Excel 改過」
              </button>
              <button type="button" onClick={() => setAll('conflict', true)}>
                衝突一律採用 Excel
              </button>
              <button type="button" onClick={() => setAll('conflict', false)}>
                衝突一律保留現況
              </button>
            </div>

            <div className="report-list">
              {actionable.map((change) => (
                <label
                  key={change.cellKey}
                  className={`report-item report-item--${change.status}`}
                >
                  <input
                    type="checkbox"
                    checked={decisions[change.cellKey] ?? false}
                    onChange={(e) =>
                      setDecisions((prev) => ({ ...prev, [change.cellKey]: e.target.checked }))
                    }
                  />
                  <div className="report-item-body">
                    <div className="report-item-head">
                      <span className="report-item-where">{describeCell(project, change.cellKey)}</span>
                      <span className="report-item-status">{STATUS_LABEL[change.status]}</span>
                    </div>
                    <div className="report-diff">
                      <div>
                        <b>現況</b>
                        <span>{stripTags(change.current, project.tagRegistry) || '（空白）'}</span>
                      </div>
                      <div>
                        <b>Excel</b>
                        <span>{stripTags(change.incoming, project.tagRegistry) || '（空白）'}</span>
                      </div>
                    </div>
                    {change.issues.length > 0 && (
                      <ul className="issue-list issue-list--inline">
                        {change.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="modal-footer">
          <button type="button" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="primary" onClick={() => onApply(decisions)}>
            套用勾選的 {acceptedCount} 項
          </button>
        </div>
      </div>
    </div>
  );
}
