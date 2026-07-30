using System.Collections.Generic;
using Newtonsoft.Json;

namespace StoryRuntime.Tags {

    // 標籤定義由 .story.json 帶進來，runtime 不內建任何一份 ——
    // 兩邊共用同一份定義才不會出現「編輯器認得、遊戲不認得」的標籤。

    public sealed class TagParamDef {
        [JsonProperty("name")] public string Name;
        // number / string / color / boolean
        [JsonProperty("type")] public string Type;
        [JsonProperty("default")] public object DefaultValue;
        [JsonProperty("description")] public string Description;

        public bool HasDefault => DefaultValue != null;
    }

    public sealed class TagDef {
        [JsonProperty("name")] public string Name;
        // paired（成對，作用於一段文字）或 inline（單點，作用於某個位置）
        [JsonProperty("kind")] public string Kind;
        // 支援 [color=#f00] 這種簡寫時，值要填進哪個參數。
        [JsonProperty("positional")] public string Positional;
        [JsonProperty("params")] public List<TagParamDef> Params = new List<TagParamDef>();
        [JsonProperty("description")] public string Description;

        public bool IsInline => Kind == "inline";
    }

    public sealed class ResolvedTag {
        public string Name;
        public Dictionary<string, TagParamValue> Params = new Dictionary<string, TagParamValue>();
    }

    public enum TagValueKind { Number, String, Bool }

    // 標籤參數的值。跟 StoryValue 分開，因為兩者的來源與轉型規則不同：
    // 這裡的 number 支援 130% 這種百分比寫法，而運算式裡沒有這回事。
    public readonly struct TagParamValue {
        public TagValueKind Kind { get; }
        readonly double _number;
        readonly string _text;
        readonly bool _bool;

        TagParamValue(TagValueKind kind, double number, string text, bool boolean) {
            Kind    = kind;
            _number = number;
            _text   = text;
            _bool   = boolean;
        }

        public static TagParamValue Number(double v) => new TagParamValue(TagValueKind.Number, v, null, false);
        public static TagParamValue Text(string v)   => new TagParamValue(TagValueKind.String, 0, v ?? "", false);
        public static TagParamValue Bool(bool v)     => new TagParamValue(TagValueKind.Bool, 0, null, v);

        public double AsNumber => _number;
        public string AsString => _text;
        public bool AsBool     => _bool;

        public string ToDisplayString() {
            switch (Kind) {
                case TagValueKind.Bool:   return _bool ? "true" : "false";
                case TagValueKind.Number: return Expressions.JsNumber.ToJsString(_number);
                default:                  return _text;
            }
        }
    }

    public sealed class TagIssue {
        public string Message;
        // 在原字串中的位置，供編輯器標示。
        public int Index;

        public TagIssue(string message, int index) {
            Message = message;
            Index   = index;
        }
    }

    public sealed class ParsedChar {
        public string Char;
        // 作用中的成對標籤，由外而內。
        public List<ResolvedTag> Effects = new List<ResolvedTag>();
        // 在這個字顯示「之前」要觸發的單點標籤（wait / speed / sfx）。
        public List<ResolvedTag> Before = new List<ResolvedTag>();
    }

    public sealed class ParsedText {
        public List<ParsedChar> Chars = new List<ParsedChar>();
        // 全文結束後才觸發的單點標籤。
        public List<ResolvedTag> Trailing = new List<ResolvedTag>();
        // 去除標記後的純文字。
        public string Plain;
        public List<TagIssue> Issues = new List<TagIssue>();
    }
}
