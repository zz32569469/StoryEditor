using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using StoryRuntime.Expressions;
using Xunit;

namespace StoryRuntime.Tests {

    // 運算式層與網頁編輯器的逐案比對。
    //
    // 期望值不是寫在這裡的 —— 全部來自 TS 端實際跑出來的結果。
    // 這個檔案唯一的職責是「拿同樣的輸入，確認 C# 得到同樣的輸出」。
    public class ExpressionGoldenTests {

        static readonly JObject Golden = GoldenData.Load("expressions.json");
        static readonly Dictionary<string, HostFunction> Builtins = Evaluator.CreateBuiltins();

        public static TheoryData<int> ExpressionCases() => Indices("expressions");
        public static TheoryData<int> AssignmentCases() => Indices("assignments");
        public static TheoryData<int> InputCases() => Indices("inputs");

        static TheoryData<int> Indices(string section) {
            var data = new TheoryData<int>();
            var items = (JArray)Golden[section];
            for (int i = 0; i < items.Count; i += 1) data.Add(i);
            return data;
        }

        [Theory]
        [MemberData(nameof(ExpressionCases))]
        public void Expression(int index) {
            JToken item = Golden["expressions"][index];
            string source = (string)item["source"];

            ParseResult<Expr> parsed = ExprParser.ParseExpression(source);

            string parseError = (string)item["parseError"];
            if (parseError != null) {
                Assert.False(parsed.Ok, $"「{source}」在 TS 端解析失敗，C# 端卻成功了");
                Assert.Equal(parseError, parsed.Error.Message);
                return;
            }

            Assert.True(parsed.Ok, $"「{source}」解析失敗：{parsed.Error?.Message}");

            var context = new EvalContext {
                Variables = GoldenData.VariablesFrom(item["variables"]),
                Functions = Builtins,
            };
            EvalResult result = Evaluator.Evaluate(parsed.Value, context);

            string evalError = (string)item["evalError"];
            if (evalError != null) {
                Assert.False(result.Ok, $"「{source}」在 TS 端求值失敗，C# 端卻得到 {result.Value}");
                Assert.Equal(evalError, result.Message);
                return;
            }

            Assert.True(result.Ok, $"「{source}」求值失敗：{result.Message}");
            AssertValue(item["result"], result.Value, source);
        }

        [Theory]
        [MemberData(nameof(AssignmentCases))]
        public void Assignment(int index) {
            JToken item = Golden["assignments"][index];
            string source = (string)item["source"];

            ParseResult<Assignment> parsed = ExprParser.ParseAssignment(source);

            string parseError = (string)item["parseError"];
            if (parseError != null) {
                Assert.False(parsed.Ok, $"「{source}」在 TS 端解析失敗，C# 端卻成功了");
                Assert.Equal(parseError, parsed.Error.Message);
                return;
            }

            Assert.True(parsed.Ok, $"「{source}」解析失敗：{parsed.Error?.Message}");
            Assert.Equal((string)item["target"], parsed.Value.Target);

            var context = new EvalContext {
                Variables = GoldenData.VariablesFrom(item["variables"]),
                Functions = Builtins,
            };
            EvalResult result = Evaluator.Evaluate(parsed.Value.Value, context);

            string evalError = (string)item["evalError"];
            if (evalError != null) {
                Assert.False(result.Ok);
                Assert.Equal(evalError, result.Message);
                return;
            }

            Assert.True(result.Ok, $"「{source}」求值失敗：{result.Message}");
            AssertValue(item["result"], result.Value, source);
        }

        [Theory]
        [MemberData(nameof(InputCases))]
        public void InputTargets(int index) {
            JToken item = Golden["inputs"][index];
            string source = (string)item["source"];

            ParseResult<List<string>> parsed = ExprParser.ParseInputTargets(source);

            string error = (string)item["error"];
            if (error != null) {
                Assert.False(parsed.Ok, $"「{source}」在 TS 端失敗，C# 端卻成功了");
                Assert.Equal(error, parsed.Error.Message);
                return;
            }

            Assert.True(parsed.Ok, $"「{source}」解析失敗：{parsed.Error?.Message}");
            Assert.Equal(item["names"].ToObject<List<string>>(), parsed.Value);
        }

        // 比對 type + display 就等於比對值本身，而且順帶驗證了「插進台詞時會看到什麼」——
        // 數字轉字串是 JS 與 .NET 差異最多的地方（布林大小寫、負零、指數門檻、文化設定）。
        static void AssertValue(JToken expected, StoryValue actual, string source) {
            string expectedType = (string)expected["type"];
            string actualType =
                actual.Kind == ValueKind.Number ? "number" :
                actual.Kind == ValueKind.Bool ? "bool" : "string";

            Assert.True(expectedType == actualType,
                $"「{source}」型別不同：TS 是 {expectedType}，C# 是 {actualType}");
            Assert.True((string)expected["display"] == actual.ToDisplayString(),
                $"「{source}」結果不同：TS 是 {(string)expected["display"]}，C# 是 {actual.ToDisplayString()}");
        }
    }
}
