using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using StoryRuntime.Tags;
using Xunit;

namespace StoryRuntime.Tests {

    // 變數插值的逐案比對。
    //
    // 這一層同時是安全邊界：玩家自己打的名字會被插進台詞，而台詞最後會餵給 TMP。
    // 兩邊的轉義規則若不一致，網頁預覽看起來正常的東西到遊戲裡會把版面撐爆。
    public class InterpolationGoldenTests {

        static readonly JObject Golden = GoldenData.Load("interpolations.json");

        public static TheoryData<int> Cases() {
            var data = new TheoryData<int>();
            var items = (JArray)Golden["interpolations"];
            for (int i = 0; i < items.Count; i += 1) data.Add(i);
            return data;
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void Interpolate(int index) {
            JToken item = Golden["interpolations"][index];
            string input = (string)item["input"];

            var values = new Dictionary<string, string>();
            foreach (var pair in (JObject)item["variables"]) values[pair.Key] = (string)pair.Value;

            var missing = new List<string>();
            string actual = Interpolation.Interpolate(
                input, name => values.TryGetValue(name, out string v) ? v : null, missing);

            Assert.True((string)item["output"] == actual,
                $"「{input}」結果不同：TS 是「{(string)item["output"]}」，C# 是「{actual}」");
            Assert.Equal(item["missing"].ToObject<List<string>>(), missing);
        }

        // 逐字動畫直接用索引推進，轉義若改變字數就會整段錯開。
        [Theory]
        [InlineData("<a<b<c")]
        [InlineData("<size=500%>")]
        [InlineData("普通的名字")]
        public void EscapingKeepsLength(string value) =>
            Assert.Equal(value.Length, Interpolation.EscapeValue(value).Length);
    }
}
