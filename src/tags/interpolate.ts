/**
 * 文字插值：把 `<變數名>` 換成變數的值。
 *
 * **尖括號在這份劇本裡專門用於變數**，不是特效標記 ——
 * 特效標記用方括號或大括號（見 parse.ts）。兩者分工明確，不會互相打架。
 *
 * 插值在標記解析**之前**完成：替換出來的值可能含有標記，
 * 順序反過來的話那些標記就不會被渲染。
 */

/** 只有單一名稱、沒有參數也沒有斜線的尖括號才算插值。 */
const PLACEHOLDER_RE = /<([A-Za-z_][A-Za-z0-9_]*)>/g;

export interface InterpolateResult {
  text: string;
  /** 文字中出現過的變數名，依出現順序去重。 */
  used: string[];
  /** 找不到值的變數名。 */
  missing: string[];
}

/**
 * 把插進來的值裡的 `<` 換成全形 `＜`。
 *
 * 值多半來自玩家輸入（MQ-0 就讓玩家打自己的姓名）。**尖括號在這套系統裡按定義
 * 就不是標記** —— 它專屬變數插值，值裡出現 `<` 沒有任何正當用途。
 * 但它會原樣傳到 TMP，玩家把名字打成 `<size=500%>` 就能把整段字撐爆。
 *
 * 只換 `<`：方括號與大括號**刻意保留**，因為值裡放標記是既有且有意的能力
 * （見「插值先於標記解析」那個測試）。一換一，逐字動畫的索引不受影響。
 */
export function escapeValue(value: string): string {
  return value.replace(/</g, '＜');
}

export function interpolate(
  text: string,
  resolve: (name: string) => string | undefined,
): InterpolateResult {
  const used: string[] = [];
  const missing: string[] = [];

  const output = text.replace(PLACEHOLDER_RE, (whole, name: string) => {
    if (!used.includes(name)) used.push(name);

    const value = resolve(name);
    if (value === undefined) {
      if (!missing.includes(name)) missing.push(name);
      // 保留原樣，讓使用者看得出這裡本來要放什麼。
      return whole;
    }
    return escapeValue(value);
  });

  return { text: output, used, missing };
}

/** 只取出文字中用到的變數名，不做替換。 */
export function collectPlaceholders(text: string): string[] {
  return interpolate(text, () => undefined).used;
}

/** 變數改名時，台詞裡的 `<舊名>` 也要跟著換，否則插值會失效。 */
export function renamePlaceholder(text: string, from: string, to: string): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) => (name === from ? `<${to}>` : whole));
}

/**
 * TextMeshPro 裡「不帶參數」的標記名。
 *
 * 這些寫成 `<b>`、`<i>` 的形式，與變數插值的樣子一模一樣 ——
 * 變數若取這種名字，台詞裡的 `<b>` 會被當成插值換掉，那個 TMP 標記就無聲失效。
 * 帶 `=` 的（`<color=…>`）與結束標記（`</b>`）不會撞，插值只認純識別字。
 */
export const TMP_BARE_TAGS: ReadonlySet<string> = new Set([
  'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'nobr', 'br', 'page',
  'noparse', 'allcaps', 'smallcaps', 'lowercase', 'uppercase',
]);
