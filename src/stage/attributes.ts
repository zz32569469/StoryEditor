import type { Variable } from '../schema/story';

/**
 * 劇本表「屬性變化」欄：`名稱±數字`，多個用全形逗號分隔（半形也收）。
 *
 * 例：`信任+1，幹勁-1`、`親切度EXP+3`。
 *
 * 名稱是給人看的中文，變數名卻只能是英數（運算式要用），所以兩者靠變數的
 * `label` 對起來。有 label 的變數就是這個專案的「屬性清單」，清單外的名稱
 * 一律當成寫錯 —— 自動補宣告的話，「新密度EXP」這種錯字會安安靜靜地變成
 * 一個沒人讀的新變數，數值加到那裡去，劇本作者完全不會發現。
 */

export const ATTRIBUTE_COLUMN = '屬性變化';

export interface AttributeChange {
  name: string;
  delta: number;
}

export interface ParsedAttributes {
  changes: AttributeChange[];
  /** 看不懂的片段（缺正負號、缺數字…），原樣列出給作者看。 */
  malformed: string[];
}

const SEPARATOR = /[，,]/;
/** 名稱後面接正負號與數字；全形 ＋／－ 也收，Excel 輸入法常打出全形。 */
const ITEM = /^(.+?)\s*([+\-＋－])\s*(\d+(?:\.\d+)?)$/u;

export function parseAttributeChanges(text: string): ParsedAttributes {
  const changes: AttributeChange[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(SEPARATOR)) {
    const part = raw.trim();
    if (!part) continue;
    const match = ITEM.exec(part);
    if (!match) {
      malformed.push(part);
      continue;
    }
    const sign = match[2] === '-' || match[2] === '－' ? -1 : 1;
    changes.push({ name: match[1]!.trim(), delta: sign * Number(match[3]) });
  }
  return { changes, malformed };
}

/** 屬性名稱 → 變數。label 優先；也接受直接寫變數 id。 */
export function attributeTable(variables: Variable[]): Map<string, Variable> {
  const table = new Map<string, Variable>();
  for (const variable of variables) table.set(variable.id, variable);
  for (const variable of variables) {
    const label = variable.label?.trim();
    if (label) table.set(label, variable);
  }
  return table;
}
