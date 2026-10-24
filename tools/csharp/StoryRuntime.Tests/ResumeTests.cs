using System;
using System.Collections.Generic;
using StoryRuntime.Expressions;
using StoryRuntime.Story;
using Xunit;

namespace StoryRuntime.Tests {

    // ResumeAt 只有 C# 端有（網頁預覽不讀檔），沒有黃金測資可比，期望值是手寫的。
    public class ResumeTests {

        const string Json = @"{
            ""meta"": { ""formatVersion"": ""1.3.0"", ""languages"": [""zh""], ""baseLanguage"": ""zh"" },
            ""variables"": [
                { ""id"": ""affection"", ""type"": ""number"", ""default"": 0 },
                { ""id"": ""trust"", ""type"": ""number"", ""default"": 0, ""label"": ""信任"" }
            ],
            ""scenes"": [{
                ""id"": ""scene"", ""name"": ""測試"", ""entryNodeId"": ""open"",
                ""nodes"": [
                    { ""id"": ""open"", ""text"": { ""zh"": ""開場"" }, ""next"": ""gain"" },
                    { ""id"": ""gain"", ""kind"": ""set"", ""expression"": ""affection = affection + 40"", ""next"": ""ask"" },
                    { ""id"": ""ask"", ""text"": { ""zh"": ""要說什麼？"" }, ""choices"": [
                        { ""id"": ""plain"", ""text"": { ""zh"": ""普通"" }, ""targetNodeId"": ""after"" },
                        { ""id"": ""warm"", ""text"": { ""zh"": ""熟了"" }, ""targetNodeId"": ""after"", ""condition"": ""affection >= 30"" }
                    ] },
                    { ""id"": ""after"", ""text"": { ""zh"": ""之後"" }, ""stage"": { ""background"": ""店內"", ""attributes"": ""信任+1"" } }
                ]
            }]
        }";

        static readonly StoryProject Project = StoryLoader.FromJson(Json);

        [Fact]
        public void ResumeAtLineStopsThere() {
            var variables = new Variables();
            StoryState state = StoryPlayer.ResumeAt(Project, "scene", "after", variables);

            Assert.Equal(PlayerStatus.Line, state.Status);
            Assert.Equal("after", state.NodeId);
        }

        // 讀檔時選項的解鎖條件依當下變數重新判斷，而且不會重跑前面的 set。
        [Fact]
        public void ResumeAtChoicesReevaluatesUnlock() {
            var variables = new Variables();
            variables.Set("affection", StoryValue.Number(10));

            StoryState state = StoryPlayer.ResumeAt(Project, "scene", "ask", variables);

            Assert.Equal(PlayerStatus.Choices, state.Status);
            Assert.Equal(new List<string> { "plain" }, state.AvailableChoices);
            Assert.True(variables.TryGet("affection", out StoryValue affection));
            Assert.Equal("10", affection.ToDisplayString());
        }

        // 存檔時那一句已經進入過、屬性變化套用過了；讀檔要重畫背景，但不能再加一次
        [Fact]
        public void ResumeAtReplaysStageButNotAttributes() {
            var variables = new Variables();
            variables.Set("trust", StoryValue.Number(1));

            StoryState state = StoryPlayer.ResumeAt(Project, "scene", "after", variables);

            Assert.Single(state.Cues);
            Assert.Equal("店內", state.Cues[0].Stage.Background);
            Assert.Empty(state.Effects);
            Assert.True(variables.TryGet("trust", out StoryValue trust));
            Assert.Equal("1", trust.ToDisplayString());
        }

        [Fact]
        public void ResumeAtUnknownNodeFails() {
            StoryState state = StoryPlayer.ResumeAt(Project, "scene", "gone", new Variables());

            Assert.Equal(PlayerStatus.Error, state.Status);
            Assert.Equal("找不到節點 gone", state.Error);
        }

        [Fact]
        public void ResumeAtUnknownSceneFails() {
            StoryState state = StoryPlayer.ResumeAt(Project, "nope", "ask", new Variables());

            Assert.Equal(PlayerStatus.Error, state.Status);
            Assert.Equal("找不到場景 nope", state.Error);
        }

        sealed class Variables : IStoryVariables {
            readonly Dictionary<string, StoryValue> _values =
                new Dictionary<string, StoryValue>(StringComparer.Ordinal);

            public bool TryGet(string name, out StoryValue value) => _values.TryGetValue(name, out value);
            public void Set(string name, StoryValue value) => _values[name] = value;
        }
    }
}
