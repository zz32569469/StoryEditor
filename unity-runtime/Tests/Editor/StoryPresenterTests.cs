using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using StoryRuntime.Expressions;
using StoryRuntime.Story;
using StoryRuntime.Tags;
using StoryRuntime.Unity;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace StoryRuntime.UI.Tests {

    // 預設對話介面的 Presenter：閱讀規則（原型 UI25）、AUTO、立繪發話狀態、情境遮罩、輸入檢查。
    // 畫面換成不畫任何東西的假畫面，只驗證「狀態 → 畫面指令」
    public class StoryPresenterTests {

        // 一個場景涵蓋：說話者＋立繪、旁白、內心話、換表情、分支（含解鎖條件）、日期輸入、插值、結束
        const string Json = @"{
            ""meta"": { ""formatVersion"": ""1.3.0"", ""languages"": [""zh""], ""baseLanguage"": ""zh"" },
            ""variables"": [
                { ""id"": ""trust"", ""type"": ""number"", ""default"": 0 },
                { ""id"": ""opening"", ""type"": ""date"", ""default"": """", ""description"": ""開幕日"" }
            ],
            ""characters"": [
                { ""id"": ""manager"", ""name"": { ""zh"": ""店長"" } },
                { ""id"": ""narration"", ""name"": { ""zh"": ""narration"" } },
                { ""id"": ""mc_os"", ""name"": { ""zh"": ""mc os"" } },
                { ""id"": ""system"", ""name"": { ""zh"": ""system"" } }
            ],
            ""scenes"": [{
                ""id"": ""s"", ""name"": ""開幕前"", ""entryNodeId"": ""a"",
                ""nodes"": [
                    { ""id"": ""a"", ""speaker"": ""manager"", ""portrait"": ""微笑"", ""text"": { ""zh"": ""早安。"" }, ""next"": ""b"" },
                    { ""id"": ""b"", ""speaker"": ""narration"", ""text"": { ""zh"": ""店裡還沒開燈。"" }, ""next"": ""c"" },
                    { ""id"": ""c"", ""speaker"": ""mc_os"", ""text"": { ""zh"": ""（好緊張。）"" }, ""next"": ""d"" },
                    { ""id"": ""d"", ""speaker"": ""manager"", ""portrait"": ""嚴肅"", ""text"": { ""zh"": ""那就開始吧。"" }, ""next"": ""q"" },
                    { ""id"": ""q"", ""speaker"": ""manager"", ""text"": { ""zh"": """" }, ""choices"": [
                        { ""id"": ""c1"", ""text"": { ""zh"": ""好的"" }, ""targetNodeId"": ""i"" },
                        { ""id"": ""c2"", ""text"": { ""zh"": ""我有建議"" }, ""targetNodeId"": ""i"", ""condition"": ""trust >= 3"" }
                    ] },
                    { ""id"": ""i"", ""kind"": ""input"", ""speaker"": ""system"", ""expression"": ""opening"", ""next"": ""e"" },
                    { ""id"": ""e"", ""speaker"": ""system"", ""text"": { ""zh"": ""開幕日：<opening>"" }, ""next"": ""z"" },
                    { ""id"": ""z"", ""kind"": ""end"" }
                ]
            }]
        }";

        StoryProject _project;
        InMemoryStoryVariables _vars;
        FakeView _view;
        StoryPortraitTable _table;
        readonly List<Object> _objects = new List<Object>();

        [SetUp]
        public void SetUp() {
            _project = StoryLoader.FromJson(Json);
            _vars = new InMemoryStoryVariables();
            StoryPlayer.SeedDefaults(_project, _vars);
            _view = new FakeView();
            _table = ScriptableObject.CreateInstance<StoryPortraitTable>();
            _objects.Add(_table);
            foreach (var key in new[] { "微笑", "嚴肅" }) {
                var tex = new Texture2D(4, 4);
                var sprite = Sprite.Create(tex, new UnityEngine.Rect(0, 0, 4, 4), Vector2.one * 0.5f);
                sprite.name = key;
                _objects.Add(tex); _objects.Add(sprite);
                _table.entries.Add(new StoryPortraitTable.Entry { key = key, sprite = sprite });
            }
        }

        [TearDown]
        public void TearDown() {
            foreach (var o in _objects) if (o != null) Object.DestroyImmediate(o);
            _objects.Clear();
        }

        StoryPresenter Start() {
            var presenter = new StoryPresenter(_view, _project, _vars, _table);
            presenter.Start("s");
            return presenter;
        }

        // ── 閱讀規則 ─────────────────────────────────────────

        [Test]
        public void Reading_35msPerCharAnd150msAfterSentenceEnd() {
            var times = StoryPresenter.Schedule(TagParser.ParseText("你好。今", _project.TagRegistry)).Times;
            Assert.AreEqual(0.035, times[0], 1e-9);
            Assert.AreEqual(0.105, times[2], 1e-9, "句號本身照一般速度出現");
            Assert.AreEqual(0.255, times[3], 1e-9, "句號之後那一格停 150ms");
        }

        [TestCase(0, 1.4)]
        [TestCase(21, 1.4)]     // 21×65 = 1365 → 下限 1400
        [TestCase(22, 1.43)]
        [TestCase(50, 3.25)]
        [TestCase(77, 5.0)]     // 77×65 = 5005 → 上限 5000
        public void Auto_DelayIsClampedCharsTimes65ms(int chars, double seconds) {
            Assert.AreEqual(seconds, StoryPresenter.AutoDelay(chars), 1e-9);
        }

        [Test]
        public void Click_FirstRevealsThenAdvances() {
            var p = Start();
            _view.IsTyping = true;
            _view.Advance();
            Assert.AreEqual(1, _view.RevealCount);
            Assert.AreEqual("a", p.State.NodeId, "逐字還沒跑完時按一下只補完整句");
            _view.Advance();
            Assert.AreEqual("b", p.State.NodeId, "句子完整之後再按才前進");
            p.Dispose();
        }

        [Test]
        public void Auto_WaitsForLineThenAdvancesAfterFormulaDelay() {
            var p = Start();
            _view.IsTyping = true;
            _view.ClickAuto();
            Assert.AreEqual(-1, _view.AutoTimer, "還在逐字時不倒數");
            _view.FinishTyping();
            Assert.AreEqual(StoryPresenter.AutoDelay(3), _view.AutoTimer, 1e-9);
            _view.ElapseAuto();
            Assert.AreEqual("b", p.State.NodeId);
            p.Dispose();
        }

        [Test]
        public void Auto_TogglingOffCancelsCountdown() {
            var p = Start();
            _view.FinishTyping();
            _view.ClickAuto();
            Assert.AreEqual(StoryPresenter.AutoDelay(3), _view.AutoTimer, 1e-9, "句子已顯示完才開 AUTO：立刻開始倒數");
            _view.ClickAuto();
            Assert.AreEqual(-1, _view.AutoTimer);
            p.Dispose();
        }

        [Test]
        public void Auto_NeverPicksAChoice() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            p.Resume("s", "q");
            _view.ClickAuto();
            _view.FinishTyping();
            Assert.AreEqual(-1, _view.AutoTimer, "分支不倒數");
            _view.ElapseAuto();
            Assert.AreEqual(PlayerStatus.Choices, p.State.Status, "AUTO 不代選");
            p.Dispose();
        }

        [Test]
        public void Auto_ResetsForEveryNewDialogue() {
            var p = Start();
            _view.ClickAuto();
            Assert.IsTrue(_view.Auto);
            p.Dispose();
            var next = Start();
            Assert.IsFalse(next.Auto);
            Assert.IsFalse(_view.Auto, "不沿用上一次的開啟狀態");
            next.Dispose();
        }

        // ── 說話者、立繪、遮罩 ───────────────────────────────

        [Test]
        public void Speakers_PortraitOwnerStaysUpOthersDropAndNarrativeShades() {
            var p = Start();
            Assert.AreEqual("店長", _view.Speaker);
            Assert.AreEqual("微笑", _view.Portrait.name);
            Assert.IsTrue(_view.Speaking);
            Assert.IsFalse(_view.Narrative);

            _view.Advance();
            Assert.AreEqual("旁白", _view.Speaker);
            Assert.IsFalse(_view.Speaking, "別人說話時往下移");
            Assert.IsTrue(_view.Narrative);

            _view.Advance();
            Assert.AreEqual("我", _view.Speaker, "內心話的名牌只寫「我」");
            Assert.IsTrue(_view.Narrative);

            _view.Advance();
            Assert.AreEqual("嚴肅", _view.Portrait.name, "換表情");
            Assert.IsTrue(_view.Speaking);
            Assert.IsFalse(_view.Narrative);
            p.Dispose();

            Assert.AreEqual(0, StoryDialogueView.PortraitDrop(true));
            Assert.AreEqual(10 * StoryDialogueView.S, StoryDialogueView.PortraitDrop(false), 1e-4);
        }

        [Test]
        public void Speakers_RulesCanBeOverriddenPerGame() {
            var rules = new StorySpeakerRules { Override = label => label == "店長" ? "瑪莉" : null };
            var p = new StoryPresenter(_view, _project, _vars, _table, rules);
            p.Start("s");
            Assert.AreEqual("瑪莉", _view.Speaker);
            p.Dispose();
        }

        [Test]
        public void MissingPortraitKeepsPreviousAndWarns() {
            _table.entries.RemoveAll(e => e.key == "嚴肅");
            _table.Invalidate();
            LogAssert.Expect(LogType.Warning, new Regex("立繪對應表裡沒有「嚴肅」"));
            var p = new StoryPresenter(_view, _project, _vars, _table);
            p.Resume("s", "d");
            Assert.AreEqual("微笑", _view.Portrait.name, "沿用前一張");
            p.Dispose();
        }

        // ── 分支與輸入 ───────────────────────────────────────

        [Test]
        public void Choices_LockedOnesAreHidden() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            p.Resume("s", "q");
            CollectionAssert.AreEqual(new[] { "c1" }, _view.Choices.Select(c => c.Id));
            p.Dispose();

            _vars.Set("trust", StoryValue.Number(3));
            p = new StoryPresenter(_view, _project, _vars, _table);
            p.Resume("s", "q");
            CollectionAssert.AreEqual(new[] { "c1", "c2" }, _view.Choices.Select(c => c.Id));
            p.Dispose();
        }

        [Test]
        public void Input_DateIsValidatedAndInterpolated() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            p.Resume("s", "i");
            Assert.AreEqual("開幕日", _view.Inputs.Single().Label, "變數說明當欄位標題");
            Assert.AreEqual("YYYY-MM-DD", _view.Inputs.Single().Placeholder);

            _view.Submit(("opening", "明天"));
            StringAssert.Contains("YYYY-MM-DD", _view.InputError);
            Assert.AreEqual(PlayerStatus.Input, p.State.Status);

            _view.Submit(("opening", "2026-11-01"));
            Assert.AreEqual("開幕日：2026-11-01", _view.Markup);
            _view.Advance();
            Assert.IsTrue(p.IsFinished);
            Assert.IsFalse(_view.IsOpen, "播完關掉畫面");
            p.Dispose();
        }

        [Test]
        public void MissingSceneLogsErrorAndCloses() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            LogAssert.Expect(LogType.Error, new Regex("找不到場景"));
            p.Start("nope");
            Assert.IsTrue(p.IsFinished);
            Assert.IsFalse(_view.IsOpen);
            p.Dispose();
        }

        // ── 假畫面 ───────────────────────────────────────────

        sealed class FakeView : IStoryDialogueView {
            public event Action OnAdvanceClick;
            public event Action<string> OnChoiceClick;
            public event Action<IReadOnlyDictionary<string, string>> OnInputSubmit;
            public event Action OnAutoClick;
            public event Action OnLineShown;
            public event Action OnAutoElapsed;

            public bool IsTyping { get; set; }
            public bool IsOpen, Auto, Narrative, Speaking;
            public string Speaker, Markup, InputError;
            public Sprite Portrait;
            public int RevealCount;
            public double AutoTimer = -1;
            public List<StoryChoiceItem> Choices = new List<StoryChoiceItem>();
            public List<StoryInputItem> Inputs = new List<StoryInputItem>();

            public void Open() => IsOpen = true;
            public void Close() => IsOpen = false;
            public void ShowLine(string speaker, string markup, TypewriterSchedule schedule) {
                Speaker = speaker; Markup = markup; AutoTimer = -1;
            }
            public void RevealAll() { RevealCount++; IsTyping = false; }
            public void ShowChoices(IReadOnlyList<StoryChoiceItem> choices) => Choices = choices.ToList();
            public void ShowInput(IReadOnlyList<StoryInputItem> fields) { Inputs = fields.ToList(); InputError = null; }
            public void ShowInputError(string message) => InputError = message;
            public void SetPortrait(Sprite sprite) => Portrait = sprite;
            public void SetPortraitSpeaking(bool speaking) => Speaking = speaking;
            public void SetNarrative(bool narrative) => Narrative = narrative;
            public void SetAuto(bool on) => Auto = on;
            public void StartAutoTimer(double seconds) => AutoTimer = seconds;
            public void CancelAutoTimer() => AutoTimer = -1;

            public void Advance() => OnAdvanceClick?.Invoke();
            public void ClickAuto() => OnAutoClick?.Invoke();
            public void FinishTyping() { IsTyping = false; OnLineShown?.Invoke(); }
            public void ElapseAuto() { AutoTimer = -1; OnAutoElapsed?.Invoke(); }
            public void Submit(params (string name, string value)[] values) =>
                OnInputSubmit?.Invoke(values.ToDictionary(v => v.name, v => v.value));
        }
    }
}
