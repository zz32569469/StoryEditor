using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace StoryRuntime.Tags {

    // 把台詞裡的 `<變數名>` 換成變數的值。逐條對應 src/tags/interpolate.ts。
    //
    // 插值在標記解析**之前**完成：替換出來的值可能含有標記，順序反過來那些標記
    // 就不會被渲染（這是刻意保留的能力，見 TS 端「插值先於標記解析」的測試）。
    public static class Interpolation {

        // 只有單一名稱、沒有參數也沒有斜線的尖括號才算插值。
        static readonly Regex Placeholder =
            new Regex(@"<([A-Za-z_][A-Za-z0-9_]*)>", RegexOptions.Compiled);

        /// 把值裡的 `<` 換成全形 `＜`。
        ///
        /// 值多半來自玩家輸入。尖括號在這套系統裡按定義就不是標記 —— 它專屬變數插值，
        /// 值裡出現 `<` 沒有任何正當用途，但它會原樣傳到 TMP：玩家把名字打成
        /// `<size=500%>` 就能把整段字撐爆。
        ///
        /// 方括號與大括號刻意不動，一換一，逐字動畫的索引不受影響。
        public static string EscapeValue(string value) =>
            string.IsNullOrEmpty(value) ? "" : value.Replace('<', '＜');

        public static string Interpolate(string text, Func<string, string> resolve,
                                         List<string> missing = null) {
            if (string.IsNullOrEmpty(text)) return text ?? "";

            return Placeholder.Replace(text, match => {
                string name = match.Groups[1].Value;
                string value = resolve(name);
                if (value == null) {
                    // 保留原樣，讓人看得出這裡本來要放什麼。
                    if (missing != null && !missing.Contains(name)) missing.Add(name);
                    return match.Value;
                }
                return EscapeValue(value);
            });
        }

        public static List<string> CollectPlaceholders(string text) {
            var names = new List<string>();
            if (string.IsNullOrEmpty(text)) return names;
            foreach (Match match in Placeholder.Matches(text)) {
                string name = match.Groups[1].Value;
                if (!names.Contains(name)) names.Add(name);
            }
            return names;
        }
    }
}
