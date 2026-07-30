using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;
using StoryRuntime.Expressions;

namespace StoryRuntime.Tags {

    // 特效標記的解析器。逐條對應 src/tags/parse.ts（完整語法規格見 docs/FORMAT.md §3）。
    //
    //   成對  [shake amp=3]文字[/shake]
    //   單點  [wait=0.5]
    //   簡寫  [color=#ff3333]   等同 [color value=#ff3333]
    //   轉義  \[ \{ 與 \\
    //
    // 方括號與大括號等價，但同一組標籤的開頭與結尾必須用同一種。
    // 尖括號**不是**標記 —— 那是變數插值（見 docs/FORMAT.md §3 的說明）。
    //
    // 解析器永不拋例外：半個標籤是常態而非錯誤情境，錯誤以清單回傳，
    // 同時盡可能產出可渲染的結果。
    public static class TagParser {

        public const string BracketSyntax = "bracket";
        public const string BraceSyntax = "brace";

        static readonly Regex ColorPattern =
            new Regex(@"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$", RegexOptions.Compiled);

        public static string SyntaxOf(char c) {
            if (c == '[') return BracketSyntax;
            if (c == '{') return BraceSyntax;
            return null;
        }

        static char OpenOf(string syntax) => syntax == BraceSyntax ? '{' : '[';
        static char CloseOf(string syntax) => syntax == BraceSyntax ? '}' : ']';

        static bool IsNameChar(char c) =>
            c == '_' || c == '-' || (c >= '0' && c <= '9') ||
            (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');

        sealed class RawTag {
            public string Syntax;
            public bool Closing;
            public string Name;
            public List<KeyValuePair<string, string>> RawParams = new List<KeyValuePair<string, string>>();
            // [color=#f00] 的位置參數值；null 代表沒有用簡寫。
            public string PositionalValue;
            public int Start;
            public int End;
        }

        // 讀出開括號到對應閉括號之間的內容。回傳 null 代表這不是一個完整的標籤。
        static RawTag ReadTag(string input, int start) {
            string syntax = SyntaxOf(input[start]);
            if (syntax == null) return null;
            char close = CloseOf(syntax);

            int i = start + 1;
            bool closing = i < input.Length && input[i] == '/';
            if (closing) i += 1;

            int nameStart = i;
            while (i < input.Length && IsNameChar(input[i])) i += 1;
            string name = input.Substring(nameStart, i - nameStart).ToLowerInvariant();
            if (name.Length == 0) return null;

            var tag = new RawTag { Syntax = syntax, Closing = closing, Name = name, Start = start };

            if (i < input.Length && input[i] == '=') {
                i += 1;
                string value = ReadValue(input, ref i);
                if (value == null) return null;
                tag.PositionalValue = value;
            }

            while (i < input.Length && input[i] != close) {
                if (char.IsWhiteSpace(input[i])) {
                    i += 1;
                    continue;
                }
                int keyStart = i;
                while (i < input.Length && IsNameChar(input[i])) i += 1;
                string key = input.Substring(keyStart, i - keyStart).ToLowerInvariant();
                if (key.Length == 0 || i >= input.Length || input[i] != '=') return null;
                i += 1;
                string value = ReadValue(input, ref i);
                if (value == null) return null;
                tag.RawParams.Add(new KeyValuePair<string, string>(key, value));
            }

            if (i >= input.Length || input[i] != close) return null;
            tag.End = i + 1;
            return tag;
        }

        static string ReadValue(string input, ref int i) {
            if (i < input.Length && input[i] == '"') {
                i += 1;
                var text = new StringBuilder();
                while (i < input.Length && input[i] != '"') {
                    if (input[i] == '\\' && i + 1 < input.Length) {
                        text.Append(input[i + 1]);
                        i += 2;
                        continue;
                    }
                    text.Append(input[i]);
                    i += 1;
                }
                if (i >= input.Length || input[i] != '"') return null;
                i += 1;
                return text.ToString();
            }

            int valueStart = i;
            // 兩種閉括號都當作終止符：值裡本來就不該出現裸的 ] 或 }。
            while (i < input.Length && !char.IsWhiteSpace(input[i]) && input[i] != ']' && input[i] != '}') {
                i += 1;
            }
            return input.Substring(valueStart, i - valueStart);
        }

        struct Coerced {
            public bool Ok;
            public TagParamValue Value;
            public string Reason;
        }

        static Coerced Coerce(string raw, string type) {
            switch (type) {
                case "number": {
                    // 百分比寫法（size=130%）換算成倍率 1.3 —— TMP 的 <size=130%> 就是這個語意，
                    // 既有劇本大量使用，不接受等於逼人重寫。
                    string trimmed = raw.Trim();
                    bool percent = trimmed.EndsWith("%", StringComparison.Ordinal);
                    double n = JsNumber.Parse(percent ? trimmed.Substring(0, trimmed.Length - 1) : raw);
                    if (double.IsNaN(n) || double.IsInfinity(n)) {
                        return new Coerced { Reason = $"\"{raw}\" 不是數字" };
                    }
                    return new Coerced { Ok = true, Value = TagParamValue.Number(percent ? n / 100 : n) };
                }
                case "boolean": {
                    string lower = raw.ToLowerInvariant();
                    if (lower == "true" || lower == "1" || lower == "yes") {
                        return new Coerced { Ok = true, Value = TagParamValue.Bool(true) };
                    }
                    if (lower == "false" || lower == "0" || lower == "no") {
                        return new Coerced { Ok = true, Value = TagParamValue.Bool(false) };
                    }
                    return new Coerced { Reason = $"\"{raw}\" 不是布林值" };
                }
                case "color":
                    return ColorPattern.IsMatch(raw)
                        ? new Coerced { Ok = true, Value = TagParamValue.Text(raw) }
                        : new Coerced { Reason = $"\"{raw}\" 不是合法色碼（例 #ff3333）" };
                default:
                    return new Coerced { Ok = true, Value = TagParamValue.Text(raw) };
            }
        }

        static TagParamValue FromDefault(object value) {
            switch (value) {
                case bool b:   return TagParamValue.Bool(b);
                case long l:   return TagParamValue.Number(l);
                case double d: return TagParamValue.Number(d);
                case null:     return TagParamValue.Text("");
                default:       return TagParamValue.Text(value.ToString());
            }
        }

        static ResolvedTag Resolve(RawTag raw, TagDef def, List<TagIssue> issues) {
            var resolved = new ResolvedTag { Name = def.Name };
            var supplied = new Dictionary<string, string>(StringComparer.Ordinal);

            if (raw.PositionalValue != null) {
                if (!string.IsNullOrEmpty(def.Positional)) supplied[def.Positional] = raw.PositionalValue;
                else issues.Add(new TagIssue($"標籤 [{def.Name}] 不支援 = 簡寫", raw.Start));
            }

            foreach (KeyValuePair<string, string> pair in raw.RawParams) {
                bool known = false;
                foreach (TagParamDef param in def.Params) {
                    if (param.Name == pair.Key) { known = true; break; }
                }
                if (!known) {
                    issues.Add(new TagIssue($"標籤 [{def.Name}] 沒有參數 \"{pair.Key}\"", raw.Start));
                    continue;
                }
                supplied[pair.Key] = pair.Value;
            }

            foreach (TagParamDef param in def.Params) {
                if (!supplied.TryGetValue(param.Name, out string rawValue)) {
                    if (param.HasDefault) resolved.Params[param.Name] = FromDefault(param.DefaultValue);
                    else issues.Add(new TagIssue($"標籤 [{def.Name}] 缺少必要參數 \"{param.Name}\"", raw.Start));
                    continue;
                }
                Coerced result = Coerce(rawValue, param.Type);
                if (result.Ok) resolved.Params[param.Name] = result.Value;
                else issues.Add(new TagIssue($"[{def.Name}] 的 {param.Name}：{result.Reason}", raw.Start));
            }

            return resolved;
        }

        static string Show(string name, string syntax, bool closing = false) =>
            $"{OpenOf(syntax)}{(closing ? "/" : "")}{name}{CloseOf(syntax)}";

        public static ParsedText ParseText(string input, IEnumerable<TagDef> registry) {
            var defs = new Dictionary<string, TagDef>(StringComparer.Ordinal);
            if (registry != null) {
                foreach (TagDef def in registry) {
                    if (def?.Name != null) defs[def.Name] = def;
                }
            }

            var parsed = new ParsedText();
            var openStack = new List<(ResolvedTag Tag, int Start, string Syntax)>();
            var pending = new List<ResolvedTag>();
            var plain = new StringBuilder();
            input = input ?? "";

            // 一個字一個 UTF-16 碼元，與 JS 的 input[i] 一致 ——
            // 改用「字元簇」會讓兩邊的逐字動畫在代理對上錯開。
            void PushChar(char c) {
                var entry = new ParsedChar { Char = c.ToString(), Before = pending };
                foreach (var open in openStack) entry.Effects.Add(open.Tag);
                parsed.Chars.Add(entry);
                plain.Append(c);
                pending = new List<ResolvedTag>();
            }

            int i = 0;
            while (i < input.Length) {
                char ch = input[i];

                if (ch == '\\' && i + 1 < input.Length) {
                    PushChar(input[i + 1]);
                    i += 2;
                    continue;
                }

                string syntax = SyntaxOf(ch);
                if (syntax == null) {
                    PushChar(ch);
                    i += 1;
                    continue;
                }

                RawTag raw = ReadTag(input, i);
                if (raw == null) {
                    parsed.Issues.Add(new TagIssue(
                        $"標籤未正確結束（缺少 {CloseOf(syntax)} 或格式錯誤）", i));
                    PushChar(ch);
                    i += 1;
                    continue;
                }

                if (!defs.TryGetValue(raw.Name, out TagDef def)) {
                    parsed.Issues.Add(new TagIssue($"未知的標籤 {Show(raw.Name, raw.Syntax)}", raw.Start));
                    i = raw.End;
                    continue;
                }

                if (raw.Closing) {
                    if (def.IsInline) {
                        parsed.Issues.Add(new TagIssue(
                            $"{Show(def.Name, raw.Syntax)} 是單點標籤，不需要結束標籤", raw.Start));
                    }
                    else if (openStack.Count == 0) {
                        parsed.Issues.Add(new TagIssue(
                            $"多餘的結束標籤 {Show(def.Name, raw.Syntax, true)}", raw.Start));
                    }
                    else {
                        var top = openStack[openStack.Count - 1];
                        if (top.Tag.Name != def.Name) {
                            parsed.Issues.Add(new TagIssue(
                                $"結束標籤 {Show(def.Name, raw.Syntax, true)} 與最近的 " +
                                $"{Show(top.Tag.Name, top.Syntax)} 不匹配", raw.Start));
                        }
                        else if (top.Syntax != raw.Syntax) {
                            // 開頭用方括號、結尾用大括號（或反過來）。兩種都合法，但不能混用同一組。
                            parsed.Issues.Add(new TagIssue(
                                $"{Show(top.Tag.Name, top.Syntax)} 要用 {Show(top.Tag.Name, top.Syntax, true)} 結束，" +
                                $"不是 {Show(def.Name, raw.Syntax, true)}", raw.Start));
                            openStack.RemoveAt(openStack.Count - 1);
                        }
                        else {
                            openStack.RemoveAt(openStack.Count - 1);
                        }
                    }
                    i = raw.End;
                    continue;
                }

                ResolvedTag resolvedTag = Resolve(raw, def, parsed.Issues);
                if (def.IsInline) pending.Add(resolvedTag);
                else openStack.Add((resolvedTag, raw.Start, raw.Syntax));
                i = raw.End;
            }

            foreach (var unclosed in openStack) {
                parsed.Issues.Add(new TagIssue(
                    $"標籤 {OpenOf(unclosed.Syntax)}{unclosed.Tag.Name}{CloseOf(unclosed.Syntax)} 沒有結束標籤",
                    unclosed.Start));
            }

            parsed.Trailing = pending;
            parsed.Plain = plain.ToString();
            return parsed;
        }

        // 只取純文字，供字數統計與紀錄用。
        public static string StripTags(string input, IEnumerable<TagDef> registry) =>
            ParseText(input, registry).Plain;
    }
}
