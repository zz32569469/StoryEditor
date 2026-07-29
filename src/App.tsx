import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { CharacterPanel } from './editor/CharacterPanel';
import { ImportReport } from './editor/ImportReport';
import { NodeEditor } from './editor/NodeEditor';
import { SceneNodeList } from './editor/SceneNodeList';
import { VariablePanel } from './editor/VariablePanel';
import { exportWorkbook } from './excel/export';
import { readWorkbook } from './excel/import';
import { currentCellMap } from './excel/rows';
import { autosave, download, loadAutosave, openProjectFile, safeFileName, saveProjectFile } from './io/files';
import { checkLegacyExport, exportLegacyWorkbook } from './legacy/export';
import { importLegacyWorkbook } from './legacy/import';
import { DialogueStage } from './preview/DialogueStage';
import { KIND_LABEL } from './editor/nodeKind';
import { checkReferences, validateStoryProject } from './schema/validate';
import { useEditor } from './state/store';
import { useSplitPane } from './ui/useSplitPane';
import { defaultDecisions, mergeCells, resolveAccepted, type MergeReport } from './sync/merge';

import './App.css';

/**
 * 流程圖連同 React Flow 一起延後載入。
 *
 * 它是整個專案最大的一塊依賴，而多數時候使用者只是在改台詞 ——
 * 沒切到流程圖就不該付這個下載成本。
 */
const FlowGraph = lazy(() => import('./graph/FlowGraph'));

type Tab = 'dialogue' | 'characters' | 'variables';
type View = 'preview' | 'graph';

interface PendingImport {
  report: MergeReport;
  problems: string[];
  decisions: Record<string, boolean>;
}

export default function App() {
  const project = useEditor((s) => s.project);
  const lang = useEditor((s) => s.lang);
  const {
    loadProject,
    resetProject,
    setProjectName,
    setLang,
    addLanguage,
    setExportSnapshot,
    applyImportedCells,
  } = useEditor();

  const { containerRef, width: paneWidth, isResizing, resizerProps, resetWidth } = useSplitPane();
  const [tab, setTab] = useState<Tab>('dialogue');
  const [view, setView] = useState<View>('preview');
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [status, setStatus] = useState('');
  const projectFileRef = useRef<HTMLInputElement>(null);
  const excelFileRef = useRef<HTMLInputElement>(null);
  const legacyFileRef = useRef<HTMLInputElement>(null);

  // 開啟時接續上次的內容。壞掉的自動存檔會被 loadAutosave 擋掉。
  useEffect(() => {
    const saved = loadAutosave();
    if (saved) {
      loadProject(saved);
      setStatus('已載入上次的自動存檔');
    }
  }, [loadProject]);

  useEffect(() => {
    const timer = setTimeout(() => autosave(project), 800);
    return () => clearTimeout(timer);
  }, [project]);

  const issues = useMemo(() => checkReferences(project), [project]);
  const errorCount = issues.filter((i) => i.level === 'error').length;

  /**
   * 執行非同步動作並確保失敗一定看得見。
   *
   * 直接 `void somePromise()` 會把 rejection 吞掉 —— 使用者按了按鈕之後畫面
   * 完全沒有反應，連「壞了」都不知道。這比顯示一個難懂的錯誤更糟。
   */
  const run = (promise: Promise<void>, action: string) => {
    void promise.catch((error: unknown) => {
      console.error(`${action} 失敗`, error);
      setStatus(`${action}失敗：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const handleExportExcel = async () => {
    const result = await exportWorkbook(project);
    // 快照必須寫回專案，否則下次匯入沒有合併基準，只能整份覆蓋。
    setExportSnapshot(result.snapshot);

    // 檔名必須與來源劇本明顯不同。
    // 若直接用專案名，下載出來的檔案會覆蓋掉同名的來源 xlsx ——
    // 瀏覽器的下載目錄常常就是桌面，而來源檔往往也放在那裡。這件事真的發生過。
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const filename = `${safeFileName(project.meta.projectName)}-翻譯-${stamp}.xlsx`;
    download(result.blob, filename);
    setStatus(`已匯出 ${result.rowCount} 列：${filename}`);
  };

  const handleExcelFile = async (file: File) => {
    const read = await readWorkbook(await file.arrayBuffer(), project);

    // 拿既有劇本直接餵進來是很自然的誤用 —— 給出可行動的說明，
    // 而不是一份 0 筆變更的合併報告。
    if (read.notEditorWorkbook) {
      const found = read.sheetNames.slice(0, 4).join('、');
      setStatus(
        `「${file.name}」不是本編輯器匯出的 Excel（工作表：${found}${read.sheetNames.length > 4 ? '…' : ''}）。` +
          '既有劇本請先用 npm run convert 轉成 .story.json，再用「開啟」載入。',
      );
      return;
    }

    const report = mergeCells({
      base: project.exportSnapshot?.values ?? null,
      current: currentCellMap(project),
      incoming: read.incoming,
      readonlyEdits: read.readonlyEdits,
      registry: project.tagRegistry,
    });
    setPendingImport({ report, problems: read.problems, decisions: defaultDecisions(report) });
  };

  const handleLegacyImport = async (file: File) => {
    const name = file.name.replace(/\.xlsx$/i, '');
    const { project: imported, report } = await importLegacyWorkbook(await file.arrayBuffer(), name);

    const validation = validateStoryProject(imported);
    const errors = validation.issues.filter((i) => i.level === 'error');
    if (errors.length > 0 || !validation.project) {
      setStatus(`匯入失敗：${errors[0]?.path} ${errors[0]?.message}`);
      return;
    }

    loadProject(validation.project);

    const kinds = Object.entries(report.nodesByKind)
      .map(([k, v]) => `${KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k} ${v}`)
      .join('、');
    const kept = Object.keys(report.extrasKept);
    setStatus(
      `已匯入「${name}」：${report.scenes} 個場景、${report.rows} 列來源資料 → ${kinds}；` +
        `選項 ${report.choices}、分支 ${report.branches}、角色 ${report.characters.length}。` +
        (kept.length > 0 ? `保留製作欄位：${kept.join('、')}。` : '') +
        (report.warnings.length > 0 ? ` 提醒 ${report.warnings.length} 項：${report.warnings[0]}` : ''),
    );
  };

  const handleLegacyExport = async () => {
    const problems = checkLegacyExport(project);
    if (problems.length > 0) {
      setStatus(`無法以劇本格式匯出：${problems.join('；')}`);
      return;
    }
    const result = await exportLegacyWorkbook(project);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const filename = `${safeFileName(project.meta.projectName)}-${stamp}.xlsx`;
    download(result.blob, filename);
    setStatus(
      `已以劇本格式匯出 ${result.sheets} 個工作表、${result.rows} 列：${filename}` +
        (result.newIds > 0 ? `（其中 ${result.newIds} 列是新內容，已配發新編號）` : ''),
    );
  };

  const handleProjectFile = async (file: File) => {
    const result = await openProjectFile(file);
    if (!result.ok) {
      setStatus(`開啟失敗：${result.issues[0]?.message ?? '未知錯誤'}`);
      return;
    }
    loadProject(result.project);
    setStatus(result.warnings.length > 0 ? `已開啟（${result.warnings.length} 項提醒）` : '已開啟專案');
  };

  return (
    <div className="app">
      <header className="toolbar">
        <input
          className="project-name"
          type="text"
          value={project.meta.projectName}
          placeholder="專案名稱"
          onChange={(e) => setProjectName(e.target.value)}
        />

        <div className="toolbar-group">
          <button
            type="button"
            onClick={() => {
              if (confirm('開新專案會清掉目前的內容，確定嗎？')) {
                resetProject();
                setStatus('已建立新專案');
              }
            }}
          >
            開新
          </button>
          <button type="button" onClick={() => projectFileRef.current?.click()}>
            開啟
          </button>
          <button type="button" onClick={() => saveProjectFile(project)}>
            儲存 .story.json
          </button>
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className="primary"
            onClick={() => legacyFileRef.current?.click()}
            title="讀取原本的劇本 xlsx（標誌／ID／組／跳轉那種格式）"
          >
            匯入劇本 xlsx
          </button>
          <button
            type="button"
            onClick={() => run(handleLegacyExport(), '匯出劇本')}
            title="以原本的欄位與編號匯出回 xlsx"
          >
            匯出劇本 xlsx
          </button>
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            onClick={() => run(handleExportExcel(), '匯出 Excel')}
            title="只含可翻譯文字的工作表，供譯者修改後匯回（會逐格比對、擋衝突）"
          >
            匯出翻譯表
          </button>
          <button
            type="button"
            onClick={() => excelFileRef.current?.click()}
            title="把譯者改過的翻譯表寫回目前的專案"
          >
            匯入翻譯表
          </button>
        </div>

        <div className="toolbar-group">
          <label className="inline-field">
            語言
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              {project.meta.languages.map((code) => (
                <option key={code} value={code}>
                  {code}
                  {code === project.meta.baseLanguage ? '（基準）' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            title="新增語言"
            onClick={() => {
              const code = prompt('新增語言代碼（例：en、ja）')?.trim();
              if (code) {
                addLanguage(code);
                setLang(code);
              }
            }}
          >
            +
          </button>
        </div>

        <div className="toolbar-status">
          {errorCount > 0 ? (
            <span className="badge badge--error" title={issues.map((i) => i.message).join('\n')}>
              {errorCount} 項問題
            </span>
          ) : (
            <span className="badge badge--ok">資料正常</span>
          )}
        </div>
      </header>

      {/* 訊息用橫幅而非角落的小字：匯入失敗的說明往往很長，
          擠在工具列裡等於沒有顯示。 */}
      {status && (
        <div className={`notice ${status.includes('失敗') || status.includes('不是本編輯器') ? 'notice--error' : ''}`}>
          <span>{status}</span>
          <button type="button" onClick={() => setStatus('')} title="關閉">
            ✕
          </button>
        </div>
      )}

      <main ref={containerRef} className={`workspace ${isResizing ? 'is-resizing' : ''}`}>
        <section className="pane pane--preview">
          <nav className="view-switch">
            <button
              type="button"
              className={view === 'preview' ? 'is-active' : ''}
              onClick={() => setView('preview')}
            >
              對話預覽
            </button>
            <button
              type="button"
              className={view === 'graph' ? 'is-active' : ''}
              onClick={() => setView('graph')}
              title="看這個場景的分支結構"
            >
              流程圖
            </button>
          </nav>

          {view === 'preview' ? (
            <DialogueStage />
          ) : (
            <Suspense fallback={<p className="loading-hint">載入流程圖…</p>}>
              <FlowGraph />
            </Suspense>
          )}
        </section>

        <div className="resizer" {...resizerProps} onDoubleClick={resetWidth} />

        <aside className="pane pane--editor" style={{ width: paneWidth }}>
          <nav className="tabs">
            <button
              type="button"
              className={tab === 'dialogue' ? 'is-active' : ''}
              onClick={() => setTab('dialogue')}
            >
              劇情
            </button>
            <button
              type="button"
              className={tab === 'characters' ? 'is-active' : ''}
              onClick={() => setTab('characters')}
            >
              人物
            </button>
            <button
              type="button"
              className={tab === 'variables' ? 'is-active' : ''}
              onClick={() => setTab('variables')}
            >
              變數
              {project.variables.length > 0 && (
                <em className="tab-count">{project.variables.length}</em>
              )}
            </button>
          </nav>

          {tab === 'dialogue' && (
            <>
              <SceneNodeList />
              <hr />
              <NodeEditor />
            </>
          )}
          {tab === 'characters' && <CharacterPanel />}
          {tab === 'variables' && <VariablePanel />}
        </aside>
      </main>

      <input
        ref={projectFileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) run(handleProjectFile(file), '開啟');
          e.target.value = '';
        }}
      />
      <input
        ref={legacyFileRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) run(handleLegacyImport(file), '匯入劇本');
          e.target.value = '';
        }}
      />
      <input
        ref={excelFileRef}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) run(handleExcelFile(file), '匯入 Excel');
          e.target.value = '';
        }}
      />

      {pendingImport && (
        <ImportReport
          project={project}
          report={pendingImport.report}
          problems={pendingImport.problems}
          initialDecisions={pendingImport.decisions}
          onCancel={() => setPendingImport(null)}
          onApply={(decisions) => {
            const accepted = resolveAccepted(pendingImport.report, decisions);
            const result = applyImportedCells(accepted);
            setPendingImport(null);
            setStatus(
              `已套用 ${result.applied} 格${result.skipped ? `，略過 ${result.skipped} 格` : ''}`,
            );
          }}
        />
      )}
    </div>
  );
}
