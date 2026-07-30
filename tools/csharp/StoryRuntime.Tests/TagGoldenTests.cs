using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StoryRuntime.Tags;
using Xunit;

namespace StoryRuntime.Tests {

    // 特效標記解析的逐字比對。
    //
    // 比到「每一個字身上作用著哪些標籤」這個層級 —— 只比 plain 或只比標籤總數，
    // 會漏掉「嵌套順序不同」與「單點標籤掛在錯的字上」這兩類錯，
    // 而那正好是逐字動畫看起來不對的原因。
    public class TagGoldenTests {

        static readonly JObject Golden = GoldenData.Load("tags.json");
        static readonly List<TagDef> Registry =
            JsonConvert.DeserializeObject<List<TagDef>>(Golden["registry"].ToString());

        public static TheoryData<int> Cases() {
            var data = new TheoryData<int>();
            var items = (JArray)Golden["tags"];
            for (int i = 0; i < items.Count; i += 1) data.Add(i);
            return data;
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void Tags(int index) {
            JToken item = Golden["tags"][index];
            string input = (string)item["input"];
            string where = $"「{input}」";

            ParsedText parsed = TagParser.ParseText(input, Registry);

            Assert.True((string)item["plain"] == parsed.Plain,
                $"{where} 純文字不同：TS 是「{(string)item["plain"]}」，C# 是「{parsed.Plain}」");

            var expectedChars = (JArray)item["chars"];
            Assert.True(expectedChars.Count == parsed.Chars.Count,
                $"{where} 字數不同：TS 有 {expectedChars.Count}，C# 有 {parsed.Chars.Count}");

            for (int c = 0; c < expectedChars.Count; c += 1) {
                JToken expected = expectedChars[c];
                ParsedChar actual = parsed.Chars[c];
                string at = $"{where} 第 {c} 個字";

                Assert.True((string)expected["char"] == actual.Char,
                    $"{at} 不同：TS 是「{(string)expected["char"]}」，C# 是「{actual.Char}」");
                AssertTags(expected["effects"], actual.Effects, $"{at} 的作用標籤");
                AssertTags(expected["before"], actual.Before, $"{at} 之前的單點標籤");
            }

            AssertTags(item["trailing"], parsed.Trailing, $"{where} 結尾的單點標籤");

            var expectedIssues = (JArray)item["issues"];
            Assert.True(expectedIssues.Count == parsed.Issues.Count,
                $"{where} 問題數不同：TS 報 {expectedIssues.Count} 個，C# 報 {parsed.Issues.Count} 個" +
                $"（C# 的是：{string.Join(" / ", parsed.Issues.ConvertAll(x => x.Message))}）");

            for (int n = 0; n < expectedIssues.Count; n += 1) {
                Assert.True((string)expectedIssues[n]["message"] == parsed.Issues[n].Message,
                    $"{where} 第 {n} 個問題的訊息不同：TS 是「{(string)expectedIssues[n]["message"]}」，" +
                    $"C# 是「{parsed.Issues[n].Message}」");
                Assert.Equal((int)expectedIssues[n]["index"], parsed.Issues[n].Index);
            }
        }

        static void AssertTags(JToken expected, List<ResolvedTag> actual, string where) {
            var items = (JArray)expected;
            Assert.True(items.Count == actual.Count,
                $"{where} 數量不同：TS 有 {items.Count}，C# 有 {actual.Count}");

            for (int i = 0; i < items.Count; i += 1) {
                Assert.True((string)items[i]["name"] == actual[i].Name,
                    $"{where} 第 {i} 個名稱不同：TS 是 {(string)items[i]["name"]}，C# 是 {actual[i].Name}");

                var expectedParams = (JObject)items[i]["params"];
                Assert.True(expectedParams.Count == actual[i].Params.Count,
                    $"{where} 第 {i} 個（{actual[i].Name}）參數個數不同：" +
                    $"TS 有 {expectedParams.Count}，C# 有 {actual[i].Params.Count}");

                foreach (var pair in expectedParams) {
                    Assert.True(actual[i].Params.TryGetValue(pair.Key, out TagParamValue value),
                        $"{where} 第 {i} 個（{actual[i].Name}）少了參數 {pair.Key}");
                    string wanted = (string)pair.Value["display"];
                    Assert.True(wanted == value.ToDisplayString(),
                        $"{where} 第 {i} 個（{actual[i].Name}）的 {pair.Key} 不同：" +
                        $"TS 是 {wanted}，C# 是 {value.ToDisplayString()}");
                }
            }
        }
    }
}
