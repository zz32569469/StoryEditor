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
            Assert.AreEqual("店長", _view.SpeakingWho);
            Assert.AreEqual("右", _view.Shown["店長"].slot, "沒寫位置站右邊（原型 UI25 的位置）");
            Assert.IsFalse(_view.Narrative);

            _view.Advance();
            Assert.AreEqual("旁白", _view.Speaker);
            Assert.IsNull(_view.SpeakingWho, "旁白時沒有人在說話，立繪往下移");
            Assert.IsTrue(_view.Narrative);

            _view.Advance();
            Assert.AreEqual("我", _view.Speaker, "內心話的名牌只寫「我」");
            Assert.IsTrue(_view.Narrative);

            _view.Advance();
            Assert.AreEqual("嚴肅", _view.Portrait.name, "換表情");
            Assert.AreEqual("店長", _view.SpeakingWho);
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
        public void Input_LabelPrefersAttributeNameThenDescriptionThenId() {
            var opening = _project.Variables.Single(v => v.Id == "opening");
            var p = new StoryPresenter(_view, _project, _vars, _table);
            opening.Label = "開幕的日子";
            p.Resume("s", "i");
            Assert.AreEqual("開幕的日子", _view.Inputs.Single().Label, "屬性清單的名稱優先");

            opening.Label = null; opening.Description = "";
            p.Resume("s", "i");
            Assert.AreEqual("opening", _view.Inputs.Single().Label, "都沒寫才退回變數名稱");
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

        // ── 演出 ─────────────────────────────────────────────

        const string StageJson = @"{
            ""meta"": { ""formatVersion"": ""1.5.0"", ""languages"": [""zh""], ""baseLanguage"": ""zh"" },
            ""tagRegistry"": [{ ""name"": ""sfx"", ""kind"": ""inline"", ""positional"": ""value"", ""params"": [{ ""name"": ""value"", ""type"": ""string"" }] }],
            ""variables"": [{ ""id"": ""trust"", ""type"": ""number"", ""default"": 0, ""label"": ""信任"" }],
            ""characters"": [{ ""id"": ""manager"", ""name"": { ""zh"": ""店長"" } }],
            ""scenes"": [{
                ""id"": ""s"", ""name"": ""開店"", ""entryNodeId"": ""a"",
                ""nodes"": [
                    { ""id"": ""a"", ""speaker"": ""manager"", ""text"": { ""zh"": ""早[sfx=杯子]安。"" }, ""next"": ""b"",
                      ""stage"": { ""background"": ""店內"", ""screenEffect"": ""睜眼效果，溶接 0.8"", ""bgm"": ""早晨 2"", ""sfx"": ""門鈴"" } },
                    { ""id"": ""b"", ""kind"": ""set"", ""expression"": ""x = 1"", ""next"": ""c"",
                      ""stage"": { ""cg"": ""cg-試喝"", ""attributes"": ""信任+1"", ""items"": ""紙杯×2"", ""unlocks"": ""咖啡機"", ""target"": ""新人"" } },
                    { ""id"": ""c"", ""speaker"": ""manager"", ""text"": { ""zh"": ""好喝。"" }, ""next"": ""d"",
                      ""stage"": { ""cg"": ""無"", ""background"": ""無"", ""screenEffect"": ""震動 0.2 2，閃白，OpenNameInput，轉圈"" } },
                    { ""id"": ""d"", ""speaker"": ""manager"", ""text"": { ""zh"": ""插圖還沒畫。"" }, ""next"": ""z"",
                      ""stage"": { ""cg"": ""插圖"", ""bgm"": ""停止 1"" } },
                    { ""id"": ""z"", ""kind"": ""end"" }
                ]
            }]
        }";

        sealed class FakeAudio : IStoryAudio {
            public readonly List<string> Log = new List<string>();
            public void PlaySfx(string key) => Log.Add($"sfx:{key}");
            public void PlayBgm(string key, float fade) => Log.Add($"bgm:{key}:{fade}");
            public void StopBgm(float fade) => Log.Add($"stop:{fade}");
        }

        StorySpriteTable Images(params string[] keys) {
            var table = ScriptableObject.CreateInstance<StorySpriteTable>();
            _objects.Add(table);
            foreach (var key in keys) {
                var tex = new Texture2D(2, 2);
                var sprite = Sprite.Create(tex, new UnityEngine.Rect(0, 0, 2, 2), Vector2.one * 0.5f);
                sprite.name = key;
                _objects.Add(tex); _objects.Add(sprite);
                table.entries.Add(new StorySpriteTable.Entry { key = key, sprite = sprite });
            }
            return table;
        }

        (StoryPresenter presenter, FakeAudio audio, InMemoryStoryVariables vars) StartStage() {
            var project = StoryLoader.FromJson(StageJson);
            var vars = new InMemoryStoryVariables();
            StoryPlayer.SeedDefaults(project, vars);
            var audio = new FakeAudio();
            var presenter = new StoryPresenter(_view, project, vars, _table) {
                Backgrounds = Images("店內"),
                Cgs = Images("cg-試喝"),
                Audio = audio,
            };
            presenter.Start("s");
            return (presenter, audio, vars);
        }

        [Test]
        public void Stage_BackgroundBeforeScreenEffectsAndDissolveIsTheCrossfade() {
            var (p, audio, _) = StartStage();
            CollectionAssert.AreEqual(new[] { "背景:店內:0.8", "睜眼:1.2" }, _view.Stage,
                "同一列先換背景（溶接 0.8 秒），再播睜眼；溶接本身不是畫面效果");
            CollectionAssert.AreEqual(new[] { "sfx:門鈴", "bgm:早晨:2" }, audio.Log);
            p.Dispose();
        }

        [Test]
        public void Motion_ShakeAndWavePassedPerChar() {
            var (p, _, _) = StartStage();
            Assert.IsNull(_view.Motion, "沒有 shake／wave 的句子不必逐頂點動畫");
            p.Dispose();

            var project = StoryLoader.FromJson(Json);
            foreach (var name in new[] { "shake", "wave" }) {
                project.TagRegistry.Add(new TagDef {
                    Name = name, Kind = "paired",
                    Params = new List<TagParamDef> {
                        new TagParamDef { Name = "amp", Type = "number", DefaultValue = 2.0 },
                        new TagParamDef { Name = "freq", Type = "number", DefaultValue = 20.0 },
                    },
                });
            }
            project.Scenes[0].Nodes[0].Text["zh"] = "早[wave]安[/wave][shake amp=4]。[/shake]";
            var q = new StoryPresenter(_view, project, new InMemoryStoryVariables(), _table);
            q.Start("s");
            Assert.AreEqual(3, _view.Motion.Length);
            Assert.IsNull(_view.Motion[0]);
            Assert.AreEqual(MotionKind.Wave, _view.Motion[1][0].Kind);
            Assert.AreEqual(4, _view.Motion[2][0].Amp);
            q.Dispose();
        }

        [Test]
        public void Stage_InlineSfxPlaysWhenTypingReachesThatChar() {
            var (p, audio, _) = StartStage();
            audio.Log.Clear();
            _view.Reveal(1);
            Assert.IsEmpty(audio.Log, "[sfx=杯子] 掛在第 2 個字前面");
            _view.Reveal(2);
            CollectionAssert.AreEqual(new[] { "sfx:杯子" }, audio.Log);
            _view.Reveal(3);
            Assert.AreEqual(1, audio.Log.Count, "同一個標記只播一次");
            p.Dispose();
        }

        [Test]
        public void Stage_ControlRowCuesAndGameEventsComeWithTheNextLine() {
            var (p, _, vars) = StartStage();
            var effects = new List<AttributeEffect>();
            var items = new List<string>();
            var unlocks = new List<string>();
            var hints = new List<string>();
            p.OnEffects += list => effects.AddRange(list);
            p.OnItems += (list, target) => items.AddRange(list.Select(i => $"{i.Key}×{i.Count}@{target}"));
            p.OnUnlocks += list => unlocks.AddRange(list);
            p.OnInputHint += hints.Add;
            _view.Stage.Clear();

            _view.Advance();

            CollectionAssert.AreEqual(new[] { "插圖:cg-試喝:0", "背景:黑:0", "插圖:收:0", "震動:0.2/2", "閃白:0.2" }, _view.Stage,
                "set 列上的插圖與下一句的演出都在這一步依序執行；寫錯的「轉圈」在解析時就被擋下");
            Assert.AreEqual(1, effects.Count);
            Assert.AreEqual("trust", effects[0].Variable);
            Assert.IsTrue(vars.TryGet("trust", out var trust));
            Assert.AreEqual(1, trust.AsNumber);
            CollectionAssert.AreEqual(new[] { "紙杯×2@新人" }, items);
            CollectionAssert.AreEqual(new[] { "咖啡機" }, unlocks);
            CollectionAssert.AreEqual(new[] { "Name" }, hints, "舊寫法 OpenNameInput 交給遊戲");
            p.Dispose();
        }

        [Test]
        public void Stage_UnknownImageKeyIsSkippedWithWarning() {
            var (p, audio, _) = StartStage();
            _view.Advance();
            _view.Stage.Clear();
            LogAssert.Expect(LogType.Warning, new Regex("插圖對應表裡沒有「插圖」"));
            _view.Advance();
            Assert.IsEmpty(_view.Stage, "只寫「插圖」的佔位：跳過，不清掉目前的畫面");
            CollectionAssert.Contains(audio.Log, "stop:1");
            p.Dispose();
        }

        [Test]
        public void Stage_ResumeRestoresLastBackgroundAndBgmWithoutTransition() {
            var project = StoryLoader.FromJson(StageJson);
            var audio = new FakeAudio();
            var p = new StoryPresenter(_view, project, new InMemoryStoryVariables(), _table) {
                Backgrounds = Images("店內"), Cgs = Images("cg-試喝"), Audio = audio,
            };
            p.Resume("s", "c");
            Assert.AreEqual("背景:店內:0", _view.Stage[0], "存檔那句之前最後的背景，直接放上去");
            Assert.AreEqual("插圖:cg-試喝:0", _view.Stage[1]);
            Assert.AreEqual("bgm:早晨:0", audio.Log[0]);
            p.Dispose();
        }

        // ── 多人立繪 ─────────────────────────────────────────

        const string CastJson = @"{
            ""meta"": { ""formatVersion"": ""1.5.0"", ""languages"": [""zh""], ""baseLanguage"": ""zh"" },
            ""characters"": [
                { ""id"": ""manager"", ""name"": { ""zh"": ""店長"" } },
                { ""id"": ""rookie"", ""name"": { ""zh"": ""新人"" } },
                { ""id"": ""guest"", ""name"": { ""zh"": ""熟客"" } },
                { ""id"": ""rookie_os"", ""name"": { ""zh"": ""新人 os"" } },
                { ""id"": ""narration"", ""name"": { ""zh"": ""narration"" } }
            ],
            ""scenes"": [{
                ""id"": ""s"", ""name"": ""開店"", ""entryNodeId"": ""a"",
                ""nodes"": [
                    { ""id"": ""a"", ""speaker"": ""manager"", ""portrait"": ""微笑"", ""text"": { ""zh"": ""早。"" }, ""next"": ""b"",
                      ""stage"": { ""position"": ""左"", ""portraitEffect"": ""淡入 0.4"" } },
                    { ""id"": ""b"", ""speaker"": ""rookie"", ""portrait"": ""嚴肅"", ""text"": { ""zh"": ""早安！"" }, ""next"": ""c"",
                      ""stage"": { ""position"": ""右"", ""portraitEffect"": ""右滑入"" } },
                    { ""id"": ""c"", ""speaker"": ""rookie_os"", ""text"": { ""zh"": ""（好緊張。）"" }, ""next"": ""d"",
                      ""stage"": { ""position"": ""新人：中"" } },
                    { ""id"": ""d"", ""speaker"": ""guest"", ""portrait"": ""微笑"", ""text"": { ""zh"": ""有開嗎？"" }, ""next"": ""e"",
                      ""stage"": { ""position"": ""左"", ""portraitEffect"": ""左滑入 0.5"" } },
                    { ""id"": ""e"", ""speaker"": ""guest"", ""text"": { ""zh"": ""明天見。"" }, ""next"": ""f"",
                      ""stage"": { ""portraitEffect"": ""左滑出"" } },
                    { ""id"": ""f"", ""speaker"": ""narration"", ""portrait"": ""新人：無"", ""text"": { ""zh"": ""傍晚了。"" }, ""next"": ""g"",
                      ""stage"": { ""portraitEffect"": ""店長：淡出 1"" } },
                    { ""id"": ""g"", ""speaker"": ""narration"", ""text"": { ""zh"": ""結束。"" }, ""next"": ""z"",
                      ""stage"": { ""portraitEffect"": ""熟客：淡入"" } },
                    { ""id"": ""z"", ""kind"": ""end"" }
                ]
            }]
        }";

        [Test]
        public void Portraits_SlotsEntriesExitsAndSameSlotReplaces() {
            var p = new StoryPresenter(_view, StoryLoader.FromJson(CastJson), new InMemoryStoryVariables(), _table);
            p.Start("s");
            CollectionAssert.AreEqual(new[] { "立繪:店長:微笑:左", "效果:店長:淡入:0.4" }, _view.PortraitLog);

            _view.PortraitLog.Clear(); _view.Advance();
            CollectionAssert.AreEqual(new[] { "立繪:新人:嚴肅:右", "效果:新人:右滑入:0.3" }, _view.PortraitLog, "效果預設 0.3 秒");
            Assert.AreEqual(2, _view.Shown.Count, "兩人同時在場");

            _view.PortraitLog.Clear(); _view.Advance();
            CollectionAssert.AreEqual(new[] { "移動:新人:中" }, _view.PortraitLog, "「角色：位置」移動在場的人");
            Assert.IsNull(_view.SpeakingWho, "內心話時大家都往下移");

            _view.PortraitLog.Clear(); _view.Advance();
            CollectionAssert.AreEqual(new[] { "退場:店長", "立繪:熟客:微笑:左", "效果:熟客:左滑入:0.5" }, _view.PortraitLog,
                "站到有人的格子，原本的人換下去");
            Assert.AreEqual("熟客", _view.SpeakingWho);

            _view.PortraitLog.Clear(); _view.Advance();
            CollectionAssert.AreEqual(new[] { "效果:熟客:左滑出:0.3" }, _view.PortraitLog);
            CollectionAssert.AreEquivalent(new[] { "新人" }, _view.Shown.Keys);

            _view.PortraitLog.Clear();
            LogAssert.Expect(LogType.Warning, new Regex("「店長」不在場上"));
            _view.Advance();
            CollectionAssert.AreEqual(new[] { "退場:新人" }, _view.PortraitLog, "「角色：無」立刻離場；已經下去的人不能淡出");

            _view.PortraitLog.Clear();
            LogAssert.Expect(LogType.Warning, new Regex("「熟客」不在場上"));
            _view.Advance();
            CollectionAssert.IsEmpty(_view.PortraitLog, "不在場上的人不能淡入：要先寫立繪");
            p.Dispose();
        }

        [Test]
        public void Portraits_ResumeReplaysCastWithoutTransitions() {
            var p = new StoryPresenter(_view, StoryLoader.FromJson(CastJson), new InMemoryStoryVariables(), _table);
            p.Resume("s", "e");
            CollectionAssert.AreEquivalent(new[] { "新人" }, _view.Shown.Keys, "熟客在這一句左滑出");
            Assert.AreEqual("中", _view.Shown["新人"].slot);
            CollectionAssert.Contains(_view.PortraitLog, "退場:店長", "重播到熟客站上左邊時店長被換下");
            Assert.IsFalse(_view.PortraitLog.Any(l => l.StartsWith("效果:") && !l.Contains("左滑出")),
                "讀檔只重播站位，進場效果不重播");
            p.Dispose();
        }

        // ── 閱讀輔助 ─────────────────────────────────────────

        // a 店長 → b 旁白 → c 內心話 → d 店長 → q 選項 → i 輸入 → e 系統
        void PlayToEnd(StoryPresenter p) {
            p.Start("s");
            for (int i = 0; i < 4; i += 1) _view.Advance();
            _view.ClickChoice("c1");
            _view.Submit(("opening", "2026-11-01"));
        }

        [Test]
        public void Backlog_RecordsLinesChoicesAndInputs() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            PlayToEnd(p);
            _view.ClickBacklog();
            var log = _view.BacklogShown;
            CollectionAssert.AreEqual(
                new[] { "Line|店長|早安。", "Line|旁白|店裡還沒開燈。", "Line|我|（好緊張。）", "Line|店長|那就開始吧。",
                        "Choice||好的", "Input|開幕日|2026-11-01", "Line|系統|開幕日：2026-11-01" },
                log.Select(e => $"{e.Kind}|{e.Speaker}|{e.Text}"), "選項那句沒有台詞，不記");
            p.Dispose();
        }

        [Test]
        public void Backlog_KeepsTheNewestEntriesUpToCapacity() {
            var backlog = new StoryBacklog();
            Assert.GreaterOrEqual(backlog.Capacity, 250, "至少 250 筆");
            for (int i = 0; i < 400; i += 1) backlog.Add(new StoryBacklog.Entry { Text = i.ToString() });
            Assert.AreEqual(StoryBacklog.DefaultCapacity, backlog.Entries.Count);
            Assert.AreEqual((400 - StoryBacklog.DefaultCapacity).ToString(), backlog.Entries[0].Text, "丟掉最舊的");
            Assert.AreEqual("399", backlog.Entries.Last().Text);
        }

        [Test]
        public void Skip_FastForwardsReadLinesAndStopsAtChoices() {
            var history = new StoryReadHistory();
            var first = new StoryPresenter(_view, _project, _vars, _table) { ReadHistory = history };
            PlayToEnd(first);
            first.Dispose();
            Assert.IsTrue(history.IsRead("s", "d"));

            var p = new StoryPresenter(_view, _project, _vars, _table) { ReadHistory = history };
            p.Start("s");
            _view.ClickSkip();
            Assert.IsTrue(_view.SkipOn);
            Assert.AreEqual(StoryPresenter.SkipDelay, _view.AutoTimer, 1e-9);
            for (int i = 0; i < 3; i += 1) {
                _view.ElapseAuto();
                Assert.IsTrue(p.Skip, "讀過的句子一路跳");
            }
            Assert.AreEqual("那就開始吧。", _view.Markup);
            _view.ElapseAuto();
            Assert.AreEqual(PlayerStatus.Choices, p.State.Status);
            Assert.IsFalse(_view.SkipOn, "碰到選項就停");
            p.Dispose();
        }

        [Test]
        public void Skip_StopsAtUnreadLineAndOnClick() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            p.Start("s");
            _view.ClickSkip();
            _view.ElapseAuto();
            Assert.AreEqual("店裡還沒開燈。", _view.Markup);
            Assert.IsFalse(p.Skip, "沒讀過的句子停下來給玩家看");

            _view.ClickSkip();
            _view.Advance();
            Assert.IsFalse(p.Skip, "略過中點一下就停");
            Assert.AreEqual("店裡還沒開燈。", _view.Markup, "那一下不會前進");
            p.Dispose();
        }

        [Test]
        public void TextSpeed_ScalesScheduleAndInstantRevealsAndCycles() {
            var p = new StoryPresenter(_view, _project, _vars, _table);
            p.Start("s");
            double normal = _view.Schedule.Total;
            Assert.AreEqual("普通", _view.SpeedLabel);

            _view.ClickSpeed();
            Assert.AreEqual("快", _view.SpeedLabel);
            _view.Advance();
            var fast = StoryPresenter.Schedule(TagParser.ParseText("店裡還沒開燈。", _project.TagRegistry));
            Assert.AreEqual(fast.Total / 2, _view.Schedule.Total, 1e-9, "快 = 兩倍速");

            _view.ClickSpeed();
            Assert.AreEqual("瞬間", _view.SpeedLabel);
            int reveals = _view.RevealCount;
            _view.Advance();
            Assert.AreEqual(reveals + 1, _view.RevealCount, "瞬間：整句直接出現");

            _view.ClickSpeed();
            Assert.AreEqual("慢", _view.SpeedLabel);
            _view.ClickSpeed();
            Assert.AreEqual("普通", _view.SpeedLabel);
            Assert.Greater(normal, 0);
            p.Dispose();
        }

        [Test]
        public void QuickSave_RestoresLineVariablesHistoryAndBacklog() {
            var store = new MemoryQuickSaveStore();
            var p = new StoryPresenter(_view, _project, _vars, _table) { QuickSaves = store };
            _view.ClickQuickLoad();
            Assert.IsNull(_view.Notice, "還沒開始播不能讀");

            p.Start("s");
            _view.ClickQuickLoad();
            Assert.AreEqual("還沒有快速存檔", _view.Notice);
            for (int i = 0; i < 3; i += 1) _view.Advance();
            _vars.Set("trust", StoryValue.Number(5));
            _view.ClickQuickSave();
            Assert.AreEqual("已快速存檔", _view.Notice);

            _view.Advance();
            _vars.Set("trust", StoryValue.Number(0));
            _view.ClickQuickLoad();
            Assert.AreEqual("已讀取快速存檔", _view.Notice);
            Assert.AreEqual("d", p.State.NodeId);
            Assert.AreEqual("那就開始吧。", _view.Markup);
            Assert.AreEqual(5, _vars.TryGet("trust", out var trust) ? trust.AsNumber : -1);
            Assert.AreEqual(1, p.Backlog.Entries.Count(e => e.NodeId == "d"), "讀檔回來那一句不重複記");
            Assert.AreEqual(4, p.Backlog.Entries.Count);

            var json = store.Load().ToJson();
            StringAssert.Contains("\"trust\"", json, "整份可以轉成 JSON 放進遊戲自己的存檔");
            p.Dispose();
        }

        sealed class FakeHandler : IStoryQuickSaveHandler {
            public bool HasSave;
            public int Saves, Loads;
            public bool QuickSave() { Saves++; HasSave = true; return true; }
            public bool QuickLoad() { Loads++; return HasSave; }
        }

        [Test]
        public void QuickSave_HandlerTakesOverFromStore() {
            var handler = new FakeHandler();
            var store = new MemoryQuickSaveStore();
            var p = new StoryPresenter(_view, _project, _vars, _table) { QuickSaves = store, QuickSaveHandler = handler };
            p.Start("s");
            _view.ClickQuickLoad();
            Assert.AreEqual("還沒有快速存檔", _view.Notice);
            _view.ClickQuickSave();
            Assert.AreEqual("已快速存檔", _view.Notice);
            _view.ClickQuickLoad();
            Assert.AreEqual("已讀取快速存檔", _view.Notice);
            Assert.AreEqual((1, 2), (handler.Saves, handler.Loads));
            Assert.IsNull(store.Load(), "交給遊戲時不用內建的存放處");
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
            public event Action<int> OnReveal;
            public event Action OnBacklogClick, OnSkipClick, OnSpeedClick, OnQuickSaveClick, OnQuickLoadClick;
            public bool SkipOn;
            public string SpeedLabel, Notice;
            public List<StoryBacklog.Entry> BacklogShown;
            public TypewriterSchedule Schedule;
            public void SetSkip(bool on) => SkipOn = on;
            public void SetSpeedLabel(string label) => SpeedLabel = label;
            public void ShowBacklog(IReadOnlyList<StoryBacklog.Entry> entries) => BacklogShown = entries.ToList();
            public void ShowNotice(string message) => Notice = message;
            public void ClickBacklog() => OnBacklogClick?.Invoke();
            public void ClickSkip() => OnSkipClick?.Invoke();
            public void ClickSpeed() => OnSpeedClick?.Invoke();
            public void ClickQuickSave() => OnQuickSaveClick?.Invoke();
            public void ClickQuickLoad() => OnQuickLoadClick?.Invoke();
            public void ClickChoice(string id) => OnChoiceClick?.Invoke(id);

            public readonly List<string> Stage = new List<string>();
            public void SetBackground(Sprite sprite, float fade) => Stage.Add($"背景:{(sprite == null ? "黑" : sprite.name)}:{fade}");
            public void SetCg(Sprite sprite, float fade) => Stage.Add($"插圖:{(sprite == null ? "收" : sprite.name)}:{fade}");
            public void PlayScreenEffect(ScreenCommand command) => Stage.Add($"{command.Name}:{string.Join("/", command.Args)}");
            public void Reveal(int visible) => OnReveal?.Invoke(visible);

            public bool IsTyping { get; set; }
            public bool IsOpen, Auto, Narrative;
            public string SpeakingWho;
            public readonly Dictionary<string, (Sprite sprite, string slot)> Shown = new Dictionary<string, (Sprite, string)>();
            public readonly List<string> PortraitLog = new List<string>();
            public string Speaker, Markup, InputError;
            public Sprite Portrait;
            public int RevealCount;
            public double AutoTimer = -1;
            public List<StoryChoiceItem> Choices = new List<StoryChoiceItem>();
            public List<StoryInputItem> Inputs = new List<StoryInputItem>();

            public void Open() => IsOpen = true;
            public void Close() => IsOpen = false;
            public MotionTag[][] Motion;
            public void ShowLine(string speaker, string markup, TypewriterSchedule schedule, MotionTag[][] motion) {
                Speaker = speaker; Markup = markup; AutoTimer = -1; Motion = motion; Schedule = schedule;
            }
            public void RevealAll() { RevealCount++; IsTyping = false; }
            public void ShowChoices(IReadOnlyList<StoryChoiceItem> choices) => Choices = choices.ToList();
            public void ShowInput(IReadOnlyList<StoryInputItem> fields) { Inputs = fields.ToList(); InputError = null; }
            public void ShowInputError(string message) => InputError = message;
            public void ShowPortrait(string who, Sprite sprite, string slot) {
                Shown[who] = (sprite, slot); Portrait = sprite;
                PortraitLog.Add($"立繪:{who}:{sprite.name}:{slot}");
            }
            public void MovePortrait(string who, string slot) {
                if (Shown.TryGetValue(who, out var s)) Shown[who] = (s.sprite, slot);
                PortraitLog.Add($"移動:{who}:{slot}");
            }
            public void PlayPortraitEffect(string who, string effect, float seconds) {
                if (effect == "淡出" || effect.EndsWith("滑出")) Shown.Remove(who);
                PortraitLog.Add($"效果:{who}:{effect}:{seconds}");
            }
            public void RemovePortrait(string who) { Shown.Remove(who); PortraitLog.Add($"退場:{who}"); }
            public void SetSpeaker(string who) => SpeakingWho = who;
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
