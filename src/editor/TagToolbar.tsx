import type { RefObject } from 'react';

import type { TagDef, TagRegistry, TagSyntax } from '../schema/tags';
import { DELIMITERS } from '../tags/parse';

/**
 * 標記插入工具列。
 *
 * 按鈕由 tagRegistry 產生 —— 專案新增標籤時工具列自動跟著長出來，
 * 不需要在 UI 這邊再維護一份清單。
 */

/** 沒有預設值的參數要塞個能看懂的起始值，讓使用者直接改而不是自己拼語法。 */
const PLACEHOLDERS: Record<string, string> = {
  color: '#ff3333',
  font: 'title',
  sfx: 'sfx_key',
};

function openingTag(def: TagDef, syntax: TagSyntax): string {
  const { open, close } = DELIMITERS[syntax];
  const missing = def.params.filter((p) => p.default === undefined);
  if (def.positional && missing.some((p) => p.name === def.positional)) {
    return `${open}${def.name}=${PLACEHOLDERS[def.name] ?? 'value'}${close}`;
  }
  if (missing.length > 0) {
    const parts = missing.map((p) => `${p.name}=${PLACEHOLDERS[def.name] ?? 'value'}`);
    return `${open}${def.name} ${parts.join(' ')}${close}`;
  }
  return `${open}${def.name}${close}`;
}

export interface TagToolbarProps {
  registry: TagRegistry;
  /** 插入時使用的括號。解析器兩種都收，這裡只影響新插入的內容。 */
  syntax: TagSyntax;
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function TagToolbar({ registry, syntax, value, onChange, textareaRef }: TagToolbarProps) {
  const { open, close } = DELIMITERS[syntax];
  const insert = (def: TagDef) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const opening = openingTag(def, syntax);
    const closing = `${open}/${def.name}${close}`;

    const next =
      def.kind === 'paired'
        ? `${value.slice(0, start)}${opening}${value.slice(start, end)}${closing}${value.slice(end)}`
        : `${value.slice(0, start)}${opening}${value.slice(start)}`;

    onChange(next);

    // 插入後把游標放回內容處，讓使用者可以直接接著打字。
    queueMicrotask(() => {
      if (!el) return;
      el.focus();
      const caret =
        def.kind === 'paired' ? start + opening.length + (end - start) : start + opening.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const paired = registry.filter((t) => t.kind === 'paired');
  const inline = registry.filter((t) => t.kind === 'inline');

  return (
    <div className="tag-toolbar">
      <span className="tag-toolbar-label">套用於選取</span>
      {paired.map((def) => (
        <button key={def.name} type="button" title={def.description} onClick={() => insert(def)}>
          {def.name}
        </button>
      ))}
      <span className="tag-toolbar-sep" />
      <span className="tag-toolbar-label">插入於游標</span>
      {inline.map((def) => (
        <button key={def.name} type="button" title={def.description} onClick={() => insert(def)}>
          {def.name}
        </button>
      ))}
    </div>
  );
}
