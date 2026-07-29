using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StoryRuntime.Expressions;

namespace StoryRuntime.Tests {

    // 黃金測資由 scripts/gen-golden.ts 從編輯器實際使用的程式碼產生。
    // 這裡只負責讀，不負責判斷什麼是對的 —— 對錯的定義在 TS 那邊。
    static class GoldenData {

        public static JObject Load(string fileName) {
            string path = Path.Combine(AppContext.BaseDirectory, "golden", fileName);
            if (!File.Exists(path)) {
                throw new FileNotFoundException(
                    $"找不到黃金測資 {path}。先跑 `npm run gen:golden` 產生。", path);
            }
            return JObject.Parse(File.ReadAllText(path));
        }

        public static IVariableSource VariablesFrom(JToken token) {
            var map = new Dictionary<string, StoryValue>(StringComparer.Ordinal);
            if (token is JObject obj) {
                foreach (var pair in obj) map[pair.Key] = Decode(pair.Value);
            }
            return new DictionarySource(map);
        }

        // 測資裡的值一律以 (type, display) 表示 —— 見 gen-golden.ts 的說明。
        public static StoryValue Decode(JToken token) {
            string type = (string)token["type"];
            string display = (string)token["display"];
            switch (type) {
                case "bool":   return StoryValue.Bool(display == "true");
                case "string": return StoryValue.Text(display);
                case "number": return StoryValue.Number(ParseJsNumber(display));
                default: throw new InvalidOperationException($"測資裡有未知的型別 \"{type}\"");
            }
        }

        static double ParseJsNumber(string display) {
            switch (display) {
                case "Infinity":  return double.PositiveInfinity;
                case "-Infinity": return double.NegativeInfinity;
                case "NaN":       return double.NaN;
                default:
                    return double.Parse(display, System.Globalization.NumberStyles.Float,
                        System.Globalization.CultureInfo.InvariantCulture);
            }
        }

        sealed class DictionarySource : IVariableSource {
            readonly Dictionary<string, StoryValue> _values;
            public DictionarySource(Dictionary<string, StoryValue> values) => _values = values;
            public bool TryGet(string name, out StoryValue value) => _values.TryGetValue(name, out value);
        }
    }
}
