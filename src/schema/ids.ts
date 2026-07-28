import { ulid } from 'ulid';
import { z } from 'zod';

/**
 * 所有實體 id 一律使用 ULID（26 字元 Crockford Base32）。
 *
 * 【不可變原則】id 一旦建立就永遠不變、也永不重用。
 * 重新排序、修改文字、搬移場景、刪除後復原 —— 都不得產生新 id。
 *
 * 這是 Excel 雙向同步的地基：匯出的每一列都以 id 對齊回專案資料。
 * 一旦有任何流程會重新產生 id，合併會靜默地把譯文接到錯誤的台詞上。
 */
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export const UlidSchema = z
  .string()
  .regex(ULID_RE, 'id 必須是 26 字元的 ULID（Crockford Base32）');

export type Ulid = string;

export function newId(): Ulid {
  return ulid();
}

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

/** 人類可讀的 key（角色代號、立繪代號、字型代號、音效代號等）。 */
export const KeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'key 只能使用小寫英數、底線與連字號，且需以英數開頭');

/**
 * 變數名。
 *
 * 規則刻意與運算式解析器的識別字完全一致 —— 變數宣告必須能對上劇本裡
 * 實際寫的名稱（劇本裡的變數多半是 camelCase），
 * 用 KeySchema 那套小寫規則會讓既有劇本一匯入就驗證失敗。
 */
export const IdentifierSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '變數名只能使用英數與底線，且不能以數字開頭');

/** BCP 47 語言代碼的簡化形式，例如 zh / en / ja / zh-TW。 */
export const LangCodeSchema = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, '語言代碼格式不正確（例：zh、en、zh-TW）');
