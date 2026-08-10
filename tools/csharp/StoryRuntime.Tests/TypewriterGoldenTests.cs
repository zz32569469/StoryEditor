using Newtonsoft.Json.Linq;
using StoryRuntime.Expressions;
using StoryRuntime.Tags;
using Xunit;

namespace StoryRuntime.Tests {

    // 逐字播放的節奏比對。
    //
    // 編劇是在網頁預覽上調停頓的，兩邊算出來的時間表若不一樣，那些調整到遊戲裡就白調了。
    // 時刻以 String(number) 逐位比對而非給容差 —— 兩邊做的是同一串加法，
    // 結果本來就該一模一樣；給了容差就等於默許慢慢漂。
    public class TypewriterGoldenTests {

        static readonly JObject Golden = GoldenData.Load("schedules.json");
        static readonly JObject Tags = GoldenData.Load("tags.json");

        static readonly System.Collections.Generic.List<TagDef> Registry =
            Newtonsoft.Json.JsonConvert.DeserializeObject<System.Collections.Generic.List<TagDef>>(
                Tags["registry"].ToString());

        public static TheoryData<int> Cases() {
            var data = new TheoryData<int>();
            var items = (JArray)Golden["schedules"];
            for (int i = 0; i < items.Count; i += 1) data.Add(i);
            return data;
        }

        [Fact]
        public void BaseSpeedMatches() {
            Assert.Equal(Typewriter.DefaultCharsPerSecond, (double)Golden["baseCharsPerSecond"]);
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void Schedule(int index) {
            JToken item = Golden["schedules"][index];
            string input = (string)item["input"];

            ParsedText parsed = TagParser.ParseText(input, Registry);
            TypewriterSchedule schedule = Typewriter.Build(parsed);

            var expectedTimes = (JArray)item["times"];
            Assert.True(expectedTimes.Count == schedule.Times.Count,
                $"「{input}」字數不同：TS 有 {expectedTimes.Count}，C# 有 {schedule.Times.Count}");

            for (int i = 0; i < expectedTimes.Count; i += 1) {
                string wanted = (string)expectedTimes[i];
                string actual = JsNumber.ToJsString(schedule.Times[i]);
                Assert.True(wanted == actual,
                    $"「{input}」第 {i} 個字的時刻不同：TS 是 {wanted}，C# 是 {actual}");
            }

            Assert.True((string)item["total"] == JsNumber.ToJsString(schedule.Total),
                $"「{input}」總長不同：TS 是 {(string)item["total"]}，C# 是 {JsNumber.ToJsString(schedule.Total)}");
        }

        [Fact]
        public void VisibleAtWalksTheSchedule() {
            ParsedText parsed = TagParser.ParseText("停[wait=0.5]頓一下", Registry);
            TypewriterSchedule schedule = Typewriter.Build(parsed);

            Assert.Equal(0, schedule.VisibleAt(0));
            Assert.Equal(parsed.Chars.Count, schedule.VisibleAt(schedule.Total));
            Assert.Equal(parsed.Chars.Count, schedule.VisibleAt(schedule.Total + 10));

            // 每個字的時刻剛好到達時，那個字就該露出來。
            for (int i = 0; i < schedule.Times.Count; i += 1) {
                Assert.True(schedule.VisibleAt(schedule.Times[i]) >= i + 1,
                    $"第 {i} 個字在它自己的時刻還沒出現");
            }
        }
    }
}
