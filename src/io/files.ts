import { FORMAT_VERSION, type StoryProject } from '../schema/story';
import { validateStoryProject, type ValidationIssue } from '../schema/validate';

/**
 * 檔案存取。
 *
 * 用「下載 + 檔案選擇」而非 File System Access API：後者只有 Chromium 系瀏覽器
 * 支援，而這個工具的使用者包含編劇與翻譯，不該綁瀏覽器。代價是無法原地覆寫，
 * 每次儲存都會產生一個新檔。
 */

const AUTOSAVE_KEY = 'storyeditor:autosave:v1';

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // 立刻 revoke 會讓部分瀏覽器來不及開始下載。
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'story';
}

export function saveProjectFile(project: StoryProject): void {
  const payload: StoryProject = {
    ...project,
    meta: { ...project.meta, formatVersion: FORMAT_VERSION, updatedAt: new Date().toISOString() },
  };
  download(
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `${safeFileName(project.meta.projectName)}.story.json`,
  );
}

export type OpenResult =
  | { ok: true; project: StoryProject; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

export async function openProjectFile(file: File): Promise<OpenResult> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch (error) {
    return {
      ok: false,
      issues: [{ level: 'error', path: file.name, message: `不是合法的 JSON：${String(error)}` }],
    };
  }

  const result = validateStoryProject(data);
  if (!result.ok || !result.project) return { ok: false, issues: result.issues };

  return {
    ok: true,
    // 必須用 Zod 的輸出：舊版本檔案缺少的選填欄位只有在這裡才被補上預設值。
    project: result.project,
    warnings: result.issues.filter((i) => i.level === 'warning'),
  };
}

/** 自動存到 localStorage，避免整理到一半重新整理就全沒了。 */
export function autosave(project: StoryProject): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
  } catch {
    // 超出配額或隱私模式 —— 靜默略過，這只是保險而非主要儲存途徑。
  }
}

/** 讀回自動存檔。內容不合法就當作沒有，不讓壞資料把編輯器整個弄壞。 */
export function loadAutosave(): StoryProject | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const result = validateStoryProject(JSON.parse(raw));
    return result.ok ? (result.project ?? null) : null;
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // 同上。
  }
}
