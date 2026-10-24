using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace StoryRuntime.Story {

    public sealed class ScreenCommand {
        // 正規化後的指令名（別名會換成表裡的名字）；舊寫法 OpenNameInput 之類是 "input"
        public string Name;
        // 補齊預設值之後的數字參數
        public List<double> Args = new List<double>();
        // 只有 input 有：Name／Birthday／Level
        public string Key;
    }

    // 背景與插圖：Key 為 null 代表「無」（清除）
    public sealed class KeyCommand {
        public string Key;
    }

    public sealed class BgmCommand {
        // null = 停止
        public string Key;
        public double Fade;
    }

    public sealed class AttributeChange {
        public string Name;
        public double Delta;
    }

    public sealed class ItemChange {
        public string Key;
        public int Count;
    }

    public sealed class ParsedStage {
        public KeyCommand Background;
        public KeyCommand Cg;
        public List<ScreenCommand> Screen = new List<ScreenCommand>();
        public List<string> Sfx = new List<string>();
        public BgmCommand Bgm;
        public List<AttributeChange> Attributes = new List<AttributeChange>();
        public List<ItemChange> Items = new List<ItemChange>();
        public List<string> Unlocks = new List<string>();
        public string Target;
        public List<string> Issues = new List<string>();
    }

    // 演出欄位的解析。規格是 src/stage/directives.ts 與 attributes.ts，逐條照抄；
    // 黃金測資 directives.json 由網頁端產生，兩邊的結果與問題訊息必須逐字相同。
    //
    // 正規表示式一律寫 [0-9] 而不是 \d、[A-Za-z0-9_] 而不是 \w：
    // .NET 的 \d 與 \w 會吃全形與其他文字的數字，JavaScript 的不會，兩邊會悄悄分歧。
    public static class StageParser {

        public const string None = "無";
        public const string BgmStop = "停止";
        public const double BgmDefaultFade = 1;

        sealed class CommandDef {
            public string Name;
            public string[] Aliases;
            public double[] Defaults;
        }

        // 與 SCREEN_COMMANDS 同一份
        static readonly CommandDef[] _commands = {
            new CommandDef { Name = "睜眼", Aliases = new[] { "睜眼效果" }, Defaults = new[] { 1.2 } },
            new CommandDef { Name = "閉眼", Aliases = new[] { "閉眼效果" }, Defaults = new[] { 1.0 } },
            new CommandDef { Name = "黑幕", Aliases = new string[0], Defaults = new double[0] },
            new CommandDef { Name = "淡出", Aliases = new string[0], Defaults = new[] { 0.5 } },
            new CommandDef { Name = "淡入", Aliases = new string[0], Defaults = new[] { 0.5 } },
            new CommandDef { Name = "溶接", Aliases = new string[0], Defaults = new[] { 0.5 } },
            new CommandDef { Name = "震動", Aliases = new string[0], Defaults = new[] { 0.3, 1 } },
            new CommandDef { Name = "閃白", Aliases = new string[0], Defaults = new[] { 0.2 } },
        };

        static readonly Regex _separator = new Regex("[，,]");
        static readonly Regex _whitespace = new Regex(@"\s+");
        static readonly Regex _number = new Regex(@"^[0-9]+(\.[0-9]+)?$");
        static readonly Regex _inputHint = new Regex("^Open([A-Za-z0-9_]+)Input$");
        static readonly Regex _attribute = new Regex(@"^(.+?)\s*([+\-＋－])\s*([0-9]+(?:\.[0-9]+)?)$");
        static readonly Regex _item = new Regex(@"^(.+?)\s*[×xX*＊]\s*([0-9]+)$");
        static readonly Regex _itemTrailingMark = new Regex(@"[×xX*＊]\s*$");
        static readonly Regex _anySpace = new Regex(@"\s");

        public static ParsedStage Parse(StoryStage stage) {
            var parsed = new ParsedStage();
            var issues = parsed.Issues;

            // 問題訊息的順序要跟網頁端一樣：屬性變化、畫面效果、物品消耗、背景、插圖、OST
            parsed.Attributes = ParseAttributes(stage?.Attributes, out List<string> malformed);
            foreach (string part in malformed) {
                issues.Add($"屬性變化「{part}」看不懂，寫法是「名稱±數字」，多個用「，」分隔");
            }
            parsed.Screen = ParseScreen(stage?.ScreenEffect, issues);
            parsed.Sfx = Split(stage?.Sfx);
            parsed.Items = ParseItems(stage?.Items, issues);
            parsed.Unlocks = Split(stage?.Unlocks);
            parsed.Background = KeyOrNone(stage?.Background, "背景", issues);
            parsed.Cg = KeyOrNone(stage?.Cg, "插圖", issues);
            parsed.Bgm = ParseBgm(stage?.Bgm, issues);
            string target = stage?.Target?.Trim();
            if (!string.IsNullOrEmpty(target)) parsed.Target = target;
            return parsed;
        }

        public static List<AttributeChange> ParseAttributes(string text, out List<string> malformed) {
            var changes = new List<AttributeChange>();
            malformed = new List<string>();
            foreach (string part in Split(text)) {
                Match match = _attribute.Match(part);
                if (!match.Success) {
                    malformed.Add(part);
                    continue;
                }
                string sign = match.Groups[2].Value;
                double value = double.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture);
                changes.Add(new AttributeChange {
                    Name = match.Groups[1].Value.Trim(),
                    Delta = sign == "-" || sign == "－" ? -value : value,
                });
            }
            return changes;
        }

        static List<string> Split(string text) {
            var parts = new List<string>();
            if (string.IsNullOrEmpty(text)) return parts;
            foreach (string raw in _separator.Split(text)) {
                string part = raw.Trim();
                if (part.Length > 0) parts.Add(part);
            }
            return parts;
        }

        static string[] Words(string part) {
            var words = new List<string>();
            foreach (string w in _whitespace.Split(part)) if (w.Length > 0) words.Add(w);
            return words.ToArray();
        }

        static bool TryNumber(string raw, out double value) {
            value = 0;
            if (!_number.IsMatch(raw)) return false;
            value = double.Parse(raw, CultureInfo.InvariantCulture);
            return true;
        }

        static KeyCommand KeyOrNone(string text, string column, List<string> issues) {
            string value = text?.Trim();
            if (string.IsNullOrEmpty(value)) return null;
            if (value == None) return new KeyCommand { Key = null };
            if (_anySpace.IsMatch(value)) issues.Add($"{column}「{value}」只能寫一個代號");
            return new KeyCommand { Key = value };
        }

        static List<ScreenCommand> ParseScreen(string text, List<string> issues) {
            var commands = new List<ScreenCommand>();
            foreach (string part in Split(text)) {
                string[] words = Words(part);
                string head = words[0];
                Match input = _inputHint.Match(head);
                if (input.Success) {
                    commands.Add(new ScreenCommand { Name = "input", Key = input.Groups[1].Value });
                    continue;
                }
                CommandDef def = Find(head);
                if (def == null) {
                    var names = new List<string>();
                    foreach (CommandDef d in _commands) names.Add(d.Name);
                    issues.Add($"畫面效果「{head}」不認得（可用：{string.Join("、", names)}）");
                    continue;
                }
                if (words.Length - 1 > def.Defaults.Length) {
                    issues.Add($"畫面效果「{part}」參數太多，{def.Name}最多 {def.Defaults.Length} 個");
                    continue;
                }
                var args = new List<double>(def.Defaults);
                bool ok = true;
                for (int i = 1; i < words.Length; i += 1) {
                    if (!TryNumber(words[i], out double value)) {
                        issues.Add($"畫面效果「{part}」的參數「{words[i]}」不是數字");
                        ok = false;
                        continue;
                    }
                    args[i - 1] = value;
                }
                if (ok) commands.Add(new ScreenCommand { Name = def.Name, Args = args });
            }
            return commands;
        }

        static CommandDef Find(string head) {
            foreach (CommandDef def in _commands) {
                if (def.Name == head || Array.IndexOf(def.Aliases, head) >= 0) return def;
            }
            return null;
        }

        static BgmCommand ParseBgm(string text, List<string> issues) {
            string value = text?.Trim();
            if (string.IsNullOrEmpty(value)) return null;
            string[] words = Words(value);
            if (words.Length > 2) issues.Add($"OST「{value}」只能寫「代號 秒數」或「停止 秒數」");
            double fade = BgmDefaultFade;
            if (words.Length > 1) {
                if (TryNumber(words[1], out double parsed)) fade = parsed;
                else issues.Add($"OST「{value}」的秒數「{words[1]}」不是數字");
            }
            return new BgmCommand { Key = words[0] == BgmStop ? null : words[0], Fade = fade };
        }

        static List<ItemChange> ParseItems(string text, List<string> issues) {
            var items = new List<ItemChange>();
            foreach (string part in Split(text)) {
                Match match = _item.Match(part);
                if (match.Success) {
                    items.Add(new ItemChange {
                        Key = match.Groups[1].Value.Trim(),
                        Count = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture),
                    });
                    continue;
                }
                if (_itemTrailingMark.IsMatch(part) || _anySpace.IsMatch(part)) {
                    issues.Add($"物品消耗「{part}」寫法是「代號×數量」");
                    continue;
                }
                items.Add(new ItemChange { Key = part, Count = 1 });
            }
            return items;
        }
    }
}
