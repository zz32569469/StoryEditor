using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StoryRuntime.Expressions;
using StoryRuntime.Story;
using Xunit;

namespace StoryRuntime.Tests {

    // 整場走訪的逐步比對：同一份劇情、同樣的操作序列，
    // 每一步的狀態、停在哪個節點、走過哪些節點、變數變成什麼，全部要一致。
    //
    // 這是最能抓到分歧的一層 —— 運算式各別對得上，不代表接起來走的是同一條路。
    public class PlaythroughGoldenTests {

        static readonly JObject Golden = GoldenData.Load("playthroughs.json");

        public static TheoryData<int> Cases() {
            var data = new TheoryData<int>();
            var items = (JArray)Golden["playthroughs"];
            for (int i = 0; i < items.Count; i += 1) data.Add(i);
            return data;
        }

        [Theory]
        [MemberData(nameof(Cases))]
        public void Playthrough(int index) {
            JToken item = Golden["playthroughs"][index];
            string name = (string)item["name"];

            StoryProject project = StoryLoader.FromJson(item["project"].ToString());
            var variables = new DictionaryVariables();

            // TS 的 startScene 會先鋪專案宣告的預設值，再讓 initialVariables 覆蓋。
            // 順序反了的話，預設值會把外部注入的值蓋掉。
            StoryPlayer.SeedDefaults(project, variables);
            if (item["initialVariables"] is JObject initial) {
                foreach (var pair in initial) variables.Set(pair.Key, GoldenData.Decode(pair.Value));
            }

            var snapshots = (JArray)item["snapshots"];
            PlayerState state = StoryPlayer.StartScene(project, (string)item["sceneId"], variables);
            AssertSnapshot(snapshots[0], state, variables, name, 0);

            var steps = (JArray)item["steps"];
            for (int i = 0; i < steps.Count; i += 1) {
                JArray step = (JArray)steps[i];
                switch ((string)step[0]) {
                    case "advance":
                        state = StoryPlayer.Advance(project, state, variables);
                        break;
                    case "choose":
                        state = StoryPlayer.Choose(project, state, (string)step[1], variables);
                        break;
                    case "input": {
                        var values = new Dictionary<string, StoryValue>(StringComparer.Ordinal);
                        foreach (var pair in (JObject)step[1]) {
                            values[pair.Key] = RawInput(pair.Value);
                        }
                        state = StoryPlayer.SubmitInput(project, state, values, variables);
                        break;
                    }
                    default:
                        throw new InvalidOperationException($"未知的操作 {step[0]}");
                }
                AssertSnapshot(snapshots[i + 1], state, variables, name, i + 1);
            }
        }

        // 玩家輸入在 TS 那邊是還沒轉型的原始值，型別轉換是 submitInput 的職責。
        static StoryValue RawInput(JToken token) {
            switch (token.Type) {
                case JTokenType.Boolean: return StoryValue.Bool((bool)token);
                case JTokenType.Integer:
                case JTokenType.Float:   return StoryValue.Number((double)token);
                default:                 return StoryValue.Text((string)token);
            }
        }

        static void AssertSnapshot(
            JToken expected, PlayerState state, DictionaryVariables variables, string name, int step) {

            string where = $"「{name}」第 {step} 步";

            Assert.True((string)expected["status"] == StatusName(state.Status),
                $"{where} 狀態不同：TS 是 {(string)expected["status"]}，C# 是 {StatusName(state.Status)}");
            Assert.True((string)expected["nodeId"] == state.NodeId,
                $"{where} 停在不同節點：TS 是 {(string)expected["nodeId"]}，C# 是 {state.NodeId}");
            Assert.True((string)expected["error"] == state.Error,
                $"{where} 錯誤訊息不同：TS 是 {(string)expected["error"]}，C# 是 {state.Error}");

            Assert.Equal(expected["visited"].ToObject<List<string>>(), state.Visited);
            Assert.Equal(expected["pendingInputs"].ToObject<List<string>>(), state.PendingInputs);

            var expectedVars = (JObject)expected["variables"];
            foreach (var pair in expectedVars) {
                Assert.True(variables.TryGet(pair.Key, out StoryValue actual),
                    $"{where} 少了變數 {pair.Key}");
                string wanted = (string)pair.Value["display"];
                Assert.True(wanted == actual.ToDisplayString(),
                    $"{where} 變數 {pair.Key} 不同：TS 是 {wanted}，C# 是 {actual.ToDisplayString()}");
            }
            Assert.True(expectedVars.Count == variables.Count,
                $"{where} 變數個數不同：TS 有 {expectedVars.Count} 個，C# 有 {variables.Count} 個");
        }

        static string StatusName(PlayerStatus status) {
            switch (status) {
                case PlayerStatus.Line:    return "line";
                case PlayerStatus.Choices: return "choices";
                case PlayerStatus.Input:   return "input";
                case PlayerStatus.Ended:   return "ended";
                default:                   return "error";
            }
        }

        sealed class DictionaryVariables : IStoryVariables {
            readonly Dictionary<string, StoryValue> _values =
                new Dictionary<string, StoryValue>(StringComparer.Ordinal);

            public int Count => _values.Count;
            public bool TryGet(string name, out StoryValue value) => _values.TryGetValue(name, out value);
            public void Set(string name, StoryValue value) => _values[name] = value;
        }
    }
}
