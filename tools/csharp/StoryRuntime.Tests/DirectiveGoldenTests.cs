using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using StoryRuntime.Story;
using Xunit;

namespace StoryRuntime.Tests {

    // 演出欄位的解析比對：同一格原文，兩邊解析出的指令、參數（含補上的預設值）與問題訊息都要一樣。
    public class DirectiveGoldenTests {

        static readonly JObject Golden = GoldenData.Load("directives.json");

        public static TheoryData<int> Cases() {
            var data = new TheoryData<int>();
            var items = (JArray)Golden["directives"];
            for (int i = 0; i < items.Count; i += 1) data.Add(i);
            return data;
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void Parse(int index) {
            JToken item = Golden["directives"][index];
            var stage = item["stage"].ToObject<StoryStage>();
            JToken expected = item["parsed"];
            JObject actual = Encode(StageParser.Parse(stage));

            Assert.True(JToken.DeepEquals(expected, actual),
                $"「{item["stage"].ToString(Newtonsoft.Json.Formatting.None)}」解析不同\nTS：{expected}\nC#：{actual}");
        }

        // 照 TS 的 JSON 形狀編碼：沒寫的欄位不出現，「無」是 { key: null }
        static JObject Encode(ParsedStage parsed) {
            var screen = new JArray();
            foreach (ScreenCommand c in parsed.Screen) {
                var cmd = new JObject { ["name"] = c.Name, ["args"] = new JArray(c.Args.ConvertAll(Num).ToArray()) };
                if (c.Key != null) cmd["key"] = c.Key;
                screen.Add(cmd);
            }
            var attributes = new JArray();
            foreach (AttributeChange a in parsed.Attributes) attributes.Add(new JObject { ["name"] = a.Name, ["delta"] = Num(a.Delta) });
            var items = new JArray();
            foreach (ItemChange i in parsed.Items) items.Add(new JObject { ["key"] = i.Key, ["count"] = i.Count });

            var json = new JObject {
                ["screen"] = screen,
                ["sfx"] = new JArray(parsed.Sfx.ToArray()),
                ["attributes"] = attributes,
                ["items"] = items,
                ["unlocks"] = new JArray(parsed.Unlocks.ToArray()),
                ["issues"] = new JArray(parsed.Issues.ToArray()),
            };
            if (parsed.Background != null) json["background"] = new JObject { ["key"] = Str(parsed.Background.Key) };
            if (parsed.Cg != null) json["cg"] = new JObject { ["key"] = Str(parsed.Cg.Key) };
            if (parsed.Bgm != null) json["bgm"] = new JObject { ["key"] = Str(parsed.Bgm.Key), ["fade"] = Num(parsed.Bgm.Fade) };
            if (parsed.Target != null) json["target"] = parsed.Target;
            return json;
        }

        // JS 的 JSON 沒有整數與浮點之分，1.0 寫出來是 1；DeepEquals 會把 Integer 與 Float 當成不同
        static JToken Num(double value) =>
            value == System.Math.Floor(value) && System.Math.Abs(value) < 1e15 ? new JValue((long)value) : new JValue(value);

        // 字串 null 要寫成 JSON null，不是「字串型別、值為 null」
        static JToken Str(string value) => value == null ? JValue.CreateNull() : new JValue(value);
    }
}
