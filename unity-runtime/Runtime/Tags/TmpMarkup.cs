using System;
using System.Collections.Generic;
using System.Text;
using StoryRuntime.Expressions;

namespace StoryRuntime.Tags {

    // 把解析後的標記轉成 TextMeshPro 的 rich text。
    //
    // 對應表放在這裡而不是 .story.json 的 tagRegistry：registry 描述的是
    // 「這個標籤有哪些參數」，那是編輯器與 runtime 共用的契約；
    // 「在 TMP 裡長什麼樣」則只有 Unity 端在乎，寫進共用格式會讓網頁端
    //  帶著一份它永遠用不到的資料，而且每加一個渲染後端就要改格式版本。
    public sealed class TmpMarkup {

        public delegate void Emit(ResolvedTag tag, StringBuilder open, StringBuilder close);

        readonly Dictionary<string, Emit> _mappings = new Dictionary<string, Emit>(StringComparer.Ordinal);

        public static TmpMarkup CreateDefault() {
            var map = new TmpMarkup();

            map.Add("b", (tag, open, close) => { open.Append("<b>"); close.Append("</b>"); });
            map.Add("i", (tag, open, close) => { open.Append("<i>"); close.Append("</i>"); });

            map.Add("color", (tag, open, close) => {
                string value = Text(tag, "value", null);
                if (value == null) return;
                open.Append("<color=").Append(value).Append('>');
                close.Append("</color>");
            });

            map.Add("size", (tag, open, close) => {
                if (!TryNumber(tag, "value", out double multiplier)) return;
                // 標記裡的值是倍率（130% 解析成 1.3），TMP 吃的是百分比，要乘回去。
                // 乘完必須收斂小數：1.3 * 100 在浮點數裡是 130.00000000000003，
                // 直接輸出會變成 <size=130.00000000000003%>。
                double percent = Math.Round(multiplier * 100, 4);
                open.Append("<size=").Append(JsNumber.ToJsString(percent)).Append("%>");
                close.Append("</size>");
            });

            map.Add("font", (tag, open, close) => {
                string value = Text(tag, "value", null);
                if (string.IsNullOrEmpty(value)) return;
                // TMP 的字型名要加引號，名稱裡有空格時（"Noto Serif TC"）不加會解析失敗。
                open.Append("<font=\"").Append(value).Append("\">");
                close.Append("</font>");
            });

            // shake / wave 沒有 TMP 對應，要逐頂點動畫才做得出來（見 README 的「還沒做的」）。
            // 這裡刻意不註冊：未註冊的成對標籤不產生任何標記，文字照樣顯示，
            // 而 ParsedChar.Effects 仍留著資訊，之後做頂點動畫時直接讀得到。

            return map;
        }

        public void Add(string tagName, Emit emit) => _mappings[tagName] = emit;
        public void Remove(string tagName) => _mappings.Remove(tagName);

        /// 產生 TMP rich text。
        ///
        /// 可見字元的順序與數量跟 ParsedText.Chars 完全一致 —— 標記只插在字與字之間，
        /// 所以第 i 個字就是 TMP 的第 i 個可見字元，逐字動畫可以直接用索引推進。
        public string Render(ParsedText parsed) {
            var output = new StringBuilder();
            var open = new List<ResolvedTag>();
            var scratchOpen = new StringBuilder();
            var scratchClose = new StringBuilder();

            void CloseDownTo(int depth) {
                for (int d = open.Count - 1; d >= depth; d -= 1) {
                    scratchClose.Clear();
                    if (_mappings.TryGetValue(open[d].Name, out Emit emit)) {
                        scratchOpen.Clear();
                        emit(open[d], scratchOpen, scratchClose);
                    }
                    output.Append(scratchClose);
                }
                open.RemoveRange(depth, open.Count - depth);
            }

            foreach (ParsedChar entry in parsed.Chars) {
                // 找出與目前已開啟的標籤共用的前綴。ReferenceEquals 是刻意的：
                // 同一個標籤實例才算「還開著」，兩個內容相同但不同段的標籤要各自開關。
                int shared = 0;
                while (shared < open.Count && shared < entry.Effects.Count
                       && ReferenceEquals(open[shared], entry.Effects[shared])) {
                    shared += 1;
                }

                CloseDownTo(shared);

                for (int i = shared; i < entry.Effects.Count; i += 1) {
                    ResolvedTag tag = entry.Effects[i];
                    scratchOpen.Clear();
                    scratchClose.Clear();
                    if (_mappings.TryGetValue(tag.Name, out Emit emit)) emit(tag, scratchOpen, scratchClose);
                    output.Append(scratchOpen);
                    open.Add(tag);
                }

                output.Append(entry.Char);
            }

            CloseDownTo(0);
            return output.ToString();
        }

        static bool TryNumber(ResolvedTag tag, string key, out double value) {
            if (tag.Params.TryGetValue(key, out TagParamValue param) && param.Kind == TagValueKind.Number) {
                value = param.AsNumber;
                return true;
            }
            value = 0;
            return false;
        }

        static string Text(ResolvedTag tag, string key, string fallback) =>
            tag.Params.TryGetValue(key, out TagParamValue param) ? param.ToDisplayString() : fallback;
    }
}
