/**
 * Excel 交換用的正規化定址。
 *
 * 一列 = 一個實體（節點／選項／角色）；
 * 一格 = 該實體的一個 (欄位, 語言) 組合。
 *
 * 三方合併完全建立在 cellKey 上，因此 key 只能由不可變的 id 組成，
 * 不得混入索引、順序或文字內容。
 */
export type FieldOwnerKind = 'node' | 'choice' | 'character';
export type FieldName = 'text' | 'notes' | 'name';

export interface RowRef {
  ownerKind: FieldOwnerKind;
  ownerId: string;
}

export interface CellRef extends RowRef {
  field: FieldName;
  /** 非多語系欄位（notes）為 null。 */
  lang: string | null;
}

const OWNER_KINDS: FieldOwnerKind[] = ['node', 'choice', 'character'];
const FIELD_NAMES: FieldName[] = ['text', 'notes', 'name'];

export function rowKey(ref: RowRef): string {
  return `${ref.ownerKind}:${ref.ownerId}`;
}

export function parseRowKey(key: string): RowRef | null {
  const parts = key.split(':');
  if (parts.length !== 2) return null;
  const [ownerKind, ownerId] = parts as [string, string];
  if (!OWNER_KINDS.includes(ownerKind as FieldOwnerKind) || !ownerId) return null;
  return { ownerKind: ownerKind as FieldOwnerKind, ownerId };
}

export function cellKey(ref: RowRef, field: FieldName, lang: string | null): string {
  return `${rowKey(ref)}:${field}:${lang ?? '-'}`;
}

export function parseCellKey(key: string): CellRef | null {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  const [ownerKind, ownerId, field, lang] = parts as [string, string, string, string];
  if (!OWNER_KINDS.includes(ownerKind as FieldOwnerKind) || !ownerId) return null;
  if (!FIELD_NAMES.includes(field as FieldName)) return null;
  return {
    ownerKind: ownerKind as FieldOwnerKind,
    ownerId,
    field: field as FieldName,
    lang: lang === '-' ? null : lang,
  };
}
