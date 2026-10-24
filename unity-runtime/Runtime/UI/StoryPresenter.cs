using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using StoryRuntime.Expressions;
using StoryRuntime.Story;
using StoryRuntime.Tags;
using UnityEngine;

namespace StoryRuntime.UI {

    // 說話者怎麼分類、名牌寫什麼。預設值照原型 UI25；各作品可以整個換掉
    public sealed class StorySpeakerRules {

        // 這些人物欄原字串套全景情境遮罩：旁白、系統、內心話（os／mind／monologue）
        public Regex Narrative = new Regex(
            @"^(narration|narrator|旁白|system|系統|系統訊息|(.+\s+)?(os|mind|monologue)|主角當下OS|主角抽離獨白)$",
            RegexOptions.IgnoreCase);

        // 內心話與主角本人：名牌只寫 ProtagonistName，不加「心聲」
        public Regex Protagonist = new Regex(
            @"^(mc|player)(\s+(os|mind|monologue|narration))?$|^(os|mind|monologue|主角當下OS|主角抽離獨白)$",
            RegexOptions.IgnoreCase);
        public string ProtagonistName = "我";

        public Regex SystemLabel = new Regex(@"^(system|系統|系統訊息)$", RegexOptions.IgnoreCase);
        public string SystemName = "系統";
        public string NarratorName = "旁白";

        // 回傳 null 表示照上面的規則；給遊戲加自己的顯示名稱對照
        public Func<string, string> Override;

        // label 是劇本表人物欄的原字串（角色的顯示名），空字串代表沒有說話者
        public bool IsNarrative(string label) => string.IsNullOrEmpty(label) || Narrative.IsMatch(label.Trim());

        // 「店長 os」這種有名字的內心話：名牌寫本人（主角的寫 ProtagonistName），不加「心聲」
        static readonly Regex _innerVoice = new Regex(@"^(.+?)\s+(os|mind|monologue)$", RegexOptions.IgnoreCase);

        public string DisplayName(string label) {
            label = (label ?? "").Trim();
            string custom = Override?.Invoke(label);
            if (custom != null) return custom;
            if (Protagonist.IsMatch(label)) return ProtagonistName;
            var inner = _innerVoice.Match(label);
            if (inner.Success) return DisplayName(inner.Groups[1].Value);
            if (SystemLabel.IsMatch(label)) return SystemName;
            if (IsNarrative(label)) return NarratorName;
            return label;
        }
    }

    // 對話的 Presenter：決定玩家每個操作之後劇情怎麼走、畫面該顯示什麼。
    // 走訪規則全在 StoryPlayer，這裡只負責「狀態 → 畫面」與閱讀規則（原型 UI25）。
    public sealed class StoryPresenter : IDisposable {

        // ── 閱讀規則（原型 UI25）────────────────────────────

        public const double CharSeconds   = 0.035;   // 每字 35ms
        public const double SentencePause = 0.15;    // 。！？!?… 之後停 150ms
        const double AutoMin = 1.4, AutoMax = 5.0, AutoPerChar = 0.065;

        // 略過時每句停留的時間：快到看不清，但還看得出在一句一句跳
        public const double SkipDelay = 0.05;

        // 文字速度的段數：倍率 1 = 每字 35ms；0 = 整句直接出現
        public static readonly (string Label, double Speed)[] SpeedSteps = { ("慢", 0.5), ("普通", 1), ("快", 2), ("瞬間", 0) };

        // AUTO 在整句顯示完後停留 max(1400, min(5000, 字數×65)) ms 才換句
        public static double AutoDelay(int chars) => Math.Max(AutoMin, Math.Min(AutoMax, chars * AutoPerChar));

        public static TypewriterSchedule Schedule(ParsedText parsed) => Schedule(parsed, 1);

        // 速度倍率同時套用在每字時間與句末停頓；0（瞬間）用一般速度排程，再由 Presenter 直接補完
        public static TypewriterSchedule Schedule(ParsedText parsed, double speed) {
            if (speed <= 0) speed = 1;
            return Typewriter.Build(parsed, speed / CharSeconds, SentencePause / speed);
        }

        static readonly Regex _datePattern = new Regex(@"^\d{4}-\d{2}-\d{2}$");
        static readonly StoryChoiceItem[] _noChoices = Array.Empty<StoryChoiceItem>();
        static readonly StoryInputItem[] _noInputs = Array.Empty<StoryInputItem>();

        readonly IStoryDialogueView _view;
        readonly StoryProject _project;
        readonly IStoryVariables _variables;
        readonly StoryPortraitTable _portraits;
        readonly StorySpeakerRules _speakers;
        readonly PlayerOptions _options;
        readonly TmpMarkup _markup = TmpMarkup.CreateDefault();
        readonly string _lang;

        // 立繪：誰在場上、用哪張；每個角色最後一次寫的位置（離場後再出場還站那裡）
        readonly Dictionary<string, string> _shown = new Dictionary<string, string>();
        readonly Dictionary<string, string> _slotOf = new Dictionary<string, string>();
        int _lineChars;
        ParsedText _parsed;
        int _revealedChars;

        // 演出資產（docs/FORMAT.md §3.5）。沒給的那一類演出會跳過並記 warning
        public StorySpriteTable Backgrounds { get; set; }
        public StorySpriteTable Cgs { get; set; }
        public IStoryAudio Audio { get; set; }

        // 沒寫過位置的角色站哪裡。預設「右」= 原型 UI25 的單人立繪位置，只有一個人的劇本看起來跟以前一樣
        public string DefaultSlot { get; set; } = "右";

        // 交給遊戲的事件：屬性變化（runtime 已依屬性清單套用到變數）、物品消耗、功能解鎖、
        // 舊寫法的輸入提示（畫面效果欄的 OpenNameInput 之類，Key 為 Name／Birthday／Level）
        public event Action<IReadOnlyList<AttributeEffect>> OnEffects;
        public event Action<IReadOnlyList<ItemChange>, string> OnItems;
        public event Action<IReadOnlyList<string>> OnUnlocks;
        public event Action<string> OnInputHint;

        // 閱讀輔助。對話紀錄與讀過的句子由控制器保管、跨場景共用；快速存檔沒給存放處時按鈕沒有作用
        public StoryBacklog Backlog { get; set; } = new StoryBacklog();
        public StoryReadHistory ReadHistory { get; set; } = new StoryReadHistory();
        public IStoryQuickSaveStore QuickSaves { get; set; }
        public bool Skip { get; private set; }

        double _textSpeed = 1;
        public double TextSpeed {
            get => _textSpeed;
            set {
                _textSpeed = Math.Max(0, value);
                _view.SetSpeedLabel(SpeedLabelOf(_textSpeed));
            }
        }

        public StoryState State { get; private set; }
        public bool IsFinished => State == null || State.Status == PlayerStatus.Ended || State.Status == PlayerStatus.Error;
        public bool IsPlaying => State != null && !IsFinished;
        public bool Auto { get; private set; }

        public event Action OnFinished;

        public StoryPresenter(IStoryDialogueView view, StoryProject project, IStoryVariables variables,
                              StoryPortraitTable portraits, StorySpeakerRules speakers = null, PlayerOptions options = null) {
            _view      = view;
            _project   = project;
            _variables = variables;
            _portraits = portraits;
            _speakers  = speakers ?? new StorySpeakerRules();
            _options   = options;
            _lang      = project.Meta?.BaseLanguage ?? "zh";

            _view.OnAdvanceClick += HandleAdvance;
            _view.OnChoiceClick  += HandleChoice;
            _view.OnInputSubmit  += HandleInput;
            _view.OnAutoClick    += HandleAutoClick;
            _view.OnLineShown    += HandleLineShown;
            _view.OnAutoElapsed  += HandleAutoElapsed;
            _view.OnReveal       += HandleReveal;
            _view.OnBacklogClick   += HandleBacklogClick;
            _view.OnSkipClick      += HandleSkipClick;
            _view.OnSpeedClick     += HandleSpeedClick;
            _view.OnQuickSaveClick += HandleQuickSave;
            _view.OnQuickLoadClick += HandleQuickLoad;
            _view.SetSpeedLabel(SpeedLabelOf(_textSpeed));
        }

        public void Dispose() {
            _view.OnAdvanceClick -= HandleAdvance;
            _view.OnChoiceClick  -= HandleChoice;
            _view.OnInputSubmit  -= HandleInput;
            _view.OnAutoClick    -= HandleAutoClick;
            _view.OnLineShown    -= HandleLineShown;
            _view.OnAutoElapsed  -= HandleAutoElapsed;
            _view.OnReveal       -= HandleReveal;
            _view.OnBacklogClick   -= HandleBacklogClick;
            _view.OnSkipClick      -= HandleSkipClick;
            _view.OnSpeedClick     -= HandleSpeedClick;
            _view.OnQuickSaveClick -= HandleQuickSave;
            _view.OnQuickLoadClick -= HandleQuickLoad;
        }

        // ── 開始 ─────────────────────────────────────────────

        public void Start(string sceneId) {
            BeginDialogue();
            State = StoryPlayer.StartScene(_project, sceneId, _variables, _options);
            Present();
        }

        public void Resume(string sceneId, string nodeId) {
            BeginDialogue();
            State = StoryPlayer.ResumeAt(_project, sceneId, nodeId, _variables, _options);
            // 讀檔回到的那一句不一定有立繪、背景，往回找最近一次的設定，不然畫面會空著直到下一次換圖
            RestorePortraits(sceneId, nodeId);
            RestoreStage(sceneId, nodeId);
            Present();
        }

        // 每次開始新對話 AUTO 一律關閉，不沿用上一次
        void BeginDialogue() {
            _shown.Clear();
            _slotOf.Clear();
            Auto = false;
            _view.Open();
            _view.SetAuto(false);
            SetSkip(false);
        }

        // ── 玩家操作 ─────────────────────────────────────────

        // 點一下先補完當句，句子完整後再點才前進
        void HandleAdvance() {
            if (!IsPlaying) return;
            // 略過中點一下：停下來，不前進
            if (Skip) { SetSkip(false); return; }
            if (_view.IsTyping) { _view.RevealAll(); return; }
            if (State.Status != PlayerStatus.Line) return;
            Next();
        }

        void HandleChoice(string choiceId) {
            if (!IsPlaying || State.Status != PlayerStatus.Choices) return;
            var chosen = StoryPlayer.CurrentNode(_project, State)?.Choices.Find(c => c.Id == choiceId);
            if (chosen != null) Record(StoryBacklog.Kind.Choice, "", _markup.Render(Render(TextOf(chosen.Text))));
            State = StoryPlayer.Choose(_project, State, choiceId, _variables, _options);
            Present();
        }

        void HandleInput(IReadOnlyDictionary<string, string> raw) {
            if (!IsPlaying || State.Status != PlayerStatus.Input) return;

            var values = new Dictionary<string, StoryValue>(StringComparer.Ordinal);
            foreach (string name in State.PendingInputs) {
                string text = raw != null && raw.TryGetValue(name, out var v) ? (v ?? "").Trim() : "";
                var declared = DeclaredOf(name);
                if (text.Length == 0) {
                    _view.ShowInputError($"請填寫「{InputLabelOf(name, declared)}」");
                    return;
                }
                // 日期在劇本裡是字串，格式錯了 CalcAge 只會默默回傳 0
                if (declared?.Type == "date" && !_datePattern.IsMatch(text)) {
                    _view.ShowInputError($"「{InputLabelOf(name, declared)}」要寫成 YYYY-MM-DD");
                    return;
                }
                values[name] = StoryValue.Text(text);
            }

            foreach (var pair in values) Record(StoryBacklog.Kind.Input, InputLabelOf(pair.Key, DeclaredOf(pair.Key)), pair.Value.AsString);
            State = StoryPlayer.SubmitInput(_project, State, values, _variables, _options);
            Present();
        }

        void HandleAutoClick() {
            if (!IsPlaying) return;
            Auto = !Auto;
            _view.SetAuto(Auto);
            if (!Auto) { _view.CancelAutoTimer(); return; }
            // 句子已經顯示完才打開 AUTO：從現在開始倒數
            if (State.Status == PlayerStatus.Line && !_view.IsTyping) _view.StartAutoTimer(AutoDelay(_lineChars));
        }

        // 分支與輸入不會自動代選，所以只在台詞上倒數
        void HandleLineShown() {
            if (Skip) return;
            if (Auto && IsPlaying && State.Status == PlayerStatus.Line) _view.StartAutoTimer(AutoDelay(_lineChars));
        }

        // 台詞內的 [sfx=代號]：逐字顯示到那個字時播放
        void HandleReveal(int visible) {
            if (_parsed == null) return;
            for (int i = _revealedChars; i < visible && i < _parsed.Chars.Count; i += 1) {
                foreach (ResolvedTag tag in _parsed.Chars[i].Before) {
                    if (tag.Name == "sfx" && tag.Params.TryGetValue("value", out TagParamValue key)) Audio?.PlaySfx(key.ToDisplayString());
                }
            }
            if (visible > _revealedChars) _revealedChars = visible;
        }

        void HandleAutoElapsed() {
            if (!(Auto || Skip) || !IsPlaying || State.Status != PlayerStatus.Line || _view.IsTyping) return;
            Next();
        }

        // ── 閱讀輔助 ─────────────────────────────────────────

        // 打開對話紀錄時停下 AUTO 與略過：玩家要回頭看，劇情不該自己往前跑
        void HandleBacklogClick() {
            if (!IsPlaying) return;
            if (Auto) HandleAutoClick();
            SetSkip(false);
            _view.ShowBacklog(Backlog.Entries);
        }

        // 略過只快轉讀過的句子；目前這句已經顯示過，從它開始跳
        void HandleSkipClick() {
            if (!IsPlaying) return;
            SetSkip(!Skip);
            if (Skip && State.Status == PlayerStatus.Line) {
                _view.RevealAll();
                _view.StartAutoTimer(SkipDelay);
            } else if (Skip) {
                SetSkip(false);
            }
        }

        void SetSkip(bool on) {
            Skip = on;
            _view.SetSkip(on);
            if (!on) _view.CancelAutoTimer();
        }

        void HandleSpeedClick() {
            int index = Array.FindIndex(SpeedSteps, s => s.Speed == _textSpeed);
            TextSpeed = SpeedSteps[(index + 1) % SpeedSteps.Length].Speed;
        }

        static string SpeedLabelOf(double speed) {
            foreach (var step in SpeedSteps) if (step.Speed == speed) return step.Label;
            return $"×{speed:0.##}";
        }

        void HandleQuickSave() {
            if (!IsPlaying || QuickSaves == null) return;
            QuickSaves.Save(CaptureQuickSave());
            _view.ShowNotice("已快速存檔");
        }

        void HandleQuickLoad() {
            if (!IsPlaying || QuickSaves == null) return;
            var data = QuickSaves.Load();
            if (data == null) { _view.ShowNotice("還沒有快速存檔"); return; }
            ApplyQuickSave(data);
            _view.ShowNotice("已讀取快速存檔");
        }

        // 存下目前這一句。對話紀錄的最後一筆如果就是這一句，不存進去 —— 讀檔回來會再顯示一次、再記一次
        public StoryQuickSave CaptureQuickSave() {
            var data = new StoryQuickSave { SceneId = State.SceneId, NodeId = State.NodeId, Read = ReadHistory.Keys };
            foreach (var variable in _project.Variables) {
                if (_variables.TryGet(variable.Id, out StoryValue value)) data.Variables[variable.Id] = StoryQuickSave.Encode(value);
            }
            data.Backlog.AddRange(Backlog.Entries);
            int last = data.Backlog.Count - 1;
            if (last >= 0 && data.Backlog[last].Kind == StoryBacklog.Kind.Line &&
                data.Backlog[last].SceneId == State.SceneId && data.Backlog[last].NodeId == State.NodeId) {
                data.Backlog.RemoveAt(last);
            }
            return data;
        }

        public void ApplyQuickSave(StoryQuickSave data) {
            foreach (var pair in data.Variables) _variables.Set(pair.Key, StoryQuickSave.Decode(pair.Value));
            ReadHistory.Load(data.Read);
            Backlog.Load(data.Backlog);
            Resume(data.SceneId, data.NodeId);
        }

        void Record(StoryBacklog.Kind kind, string speaker, string text) {
            if (string.IsNullOrEmpty(text)) return;
            Backlog.Add(new StoryBacklog.Entry { Kind = kind, Speaker = speaker, Text = text, SceneId = State.SceneId, NodeId = State.NodeId });
        }

        void Next() {
            State = StoryPlayer.Advance(_project, State, _variables, _options);
            Present();
        }

        // ── 狀態 → 畫面 ──────────────────────────────────────

        void Present() {
            _view.CancelAutoTimer();
            if (State.Status != PlayerStatus.Error) ApplyCues();

            if (State.Status == PlayerStatus.Error) {
                Debug.LogError($"[StoryPresenter] 劇情「{SceneNameOf(State.SceneId)}」出錯：{State.Error}");
                Finish();
                return;
            }
            if (State.Status == PlayerStatus.Ended) {
                Finish();
                return;
            }

            var node = StoryPlayer.CurrentNode(_project, State);
            string label = LabelOf(node.Speaker);
            bool narrative = _speakers.IsNarrative(label);
            string who = _speakers.DisplayName(label);
            ApplyPortraits(node, who, instant: false);
            _view.SetNarrative(narrative);
            _view.SetSpeaker(narrative ? null : who);

            if (State.Status == PlayerStatus.Input) {
                // 輸入節點沒有台詞：保留上一句（通常就是在問這個問題）
                SetSkip(false);
                _view.ShowChoices(_noChoices);
                _view.ShowInput(InputsOf(State.PendingInputs));
                return;
            }

            _view.ShowInput(_noInputs);
            var parsed = Render(TextOf(node.Text));
            _parsed = parsed;
            _revealedChars = 0;
            _lineChars = parsed.Chars.Count;
            bool wasRead = ReadHistory.IsRead(State.SceneId, node.Id);
            ReadHistory.MarkRead(State.SceneId, node.Id);
            string markup = _markup.Render(parsed);
            string name = _speakers.DisplayName(label);
            _view.ShowLine(name, markup, Schedule(parsed, _textSpeed), TextMotion.Build(parsed));
            _view.ShowChoices(State.Status == PlayerStatus.Choices ? ChoicesOf(node) : _noChoices);
            Record(StoryBacklog.Kind.Line, string.IsNullOrEmpty(TextOf(node.Text)) ? "" : name, markup);

            // 略過碰到沒讀過的句子、選項就停
            if (Skip && wasRead && State.Status == PlayerStatus.Line) {
                _view.RevealAll();
                _view.StartAutoTimer(SkipDelay);
            } else {
                if (Skip) SetSkip(false);
                if (_textSpeed <= 0) _view.RevealAll();
            }
        }

        // ── 演出 ─────────────────────────────────────────────

        // 依播放器回報的順序執行這一步經過的演出。同一列裡先換背景與插圖（有「溶接」就交叉淡化），
        // 再播畫面效果 —— 「睜眼」配新背景時，眼睛張開看到的才是新背景
        void ApplyCues() {
            if (State.Effects.Count > 0) OnEffects?.Invoke(State.Effects);
            foreach (StoryCue cue in State.Cues) {
                ParsedStage parsed = StageParser.Parse(cue.Stage);
                float dissolve = 0;
                foreach (ScreenCommand command in parsed.Screen) {
                    if (command.Name == "溶接") dissolve = (float)command.Args[0];
                }

                if (parsed.Background != null) {
                    ApplyImage(parsed.Background.Key, Backgrounds, "背景", sprite => _view.SetBackground(sprite, dissolve));
                }
                if (parsed.Cg != null) ApplyImage(parsed.Cg.Key, Cgs, "插圖", sprite => _view.SetCg(sprite, dissolve));

                foreach (ScreenCommand command in parsed.Screen) {
                    if (command.Name == "溶接") continue;
                    if (command.Name == "input") { OnInputHint?.Invoke(command.Key); continue; }
                    _view.PlayScreenEffect(command);
                }

                foreach (string key in parsed.Sfx) Audio?.PlaySfx(key);
                if (parsed.Bgm != null) {
                    if (parsed.Bgm.Key == null) Audio?.StopBgm((float)parsed.Bgm.Fade);
                    else Audio?.PlayBgm(parsed.Bgm.Key, (float)parsed.Bgm.Fade);
                }
                if (parsed.Items.Count > 0) OnItems?.Invoke(parsed.Items, parsed.Target);
                if (parsed.Unlocks.Count > 0) OnUnlocks?.Invoke(parsed.Unlocks);
            }
        }

        // key 為 null 是「無」：背景換全黑、插圖收起。對應表裡沒有的代號（含只寫「插圖」的佔位）跳過並記 warning
        static void ApplyImage(string key, StorySpriteTable table, string column, Action<Sprite> apply) {
            if (key == null) { apply(null); return; }
            if (table != null && table.TryGet(key, out Sprite sprite)) { apply(sprite); return; }
            Debug.LogWarning($"[StoryPresenter] {column}對應表裡沒有「{key}」，略過");
        }

        // 讀檔：照場景裡的排列，往回找存檔那一句之前最後的背景、插圖與 BGM，不帶轉場直接放上去。
        // 只看一般節點的演出 —— 分支與選項上的設定要看當時走了哪條路，存檔沒有記
        void RestoreStage(string sceneId, string nodeId) {
            var scene = _project.FindScene(sceneId);
            if (scene == null) return;
            KeyCommand background = null, cg = null;
            BgmCommand bgm = null;
            foreach (var node in scene.Nodes) {
                if (node.Id == nodeId) break;
                if (node.Stage == null) continue;
                ParsedStage parsed = StageParser.Parse(node.Stage);
                if (parsed.Background != null) background = parsed.Background;
                if (parsed.Cg != null) cg = parsed.Cg;
                if (parsed.Bgm != null) bgm = parsed.Bgm;
            }
            if (background != null) ApplyImage(background.Key, Backgrounds, "背景", sprite => _view.SetBackground(sprite, 0));
            if (cg != null) ApplyImage(cg.Key, Cgs, "插圖", sprite => _view.SetCg(sprite, 0));
            if (bgm?.Key != null) Audio?.PlayBgm(bgm.Key, 0);
        }

        void Finish() {
            Auto = false;
            _view.Close();
            OnFinished?.Invoke();
        }

        // 插值必須在標記解析之前：值裡可能含有標記，順序反過來就不會被渲染
        ParsedText Render(string source) {
            string filled = Interpolation.Interpolate(source, name =>
                _variables.TryGet(name, out StoryValue value) ? value.ToDisplayString() : null);
            return TagParser.ParseText(filled, _project.TagRegistry);
        }

        List<StoryChoiceItem> ChoicesOf(StoryNode node) {
            var items = new List<StoryChoiceItem>();
            foreach (var choice in node.Choices) {
                if (!State.AvailableChoices.Contains(choice.Id)) continue;
                items.Add(new StoryChoiceItem(choice.Id, _markup.Render(Render(TextOf(choice.Text)))));
            }
            return items;
        }

        List<StoryInputItem> InputsOf(List<string> names) {
            var items = new List<StoryInputItem>();
            foreach (string name in names) {
                var declared = DeclaredOf(name);
                string type = declared?.Type;
                string placeholder = type == "date" ? "YYYY-MM-DD" : type == "number" ? "數字" : "";
                items.Add(new StoryInputItem(name, InputLabelOf(name, declared), placeholder, type == "number"));
            }
            return items;
        }

        // 立繪、位置、立繪效果三欄。沒寫角色的指令屬於這一列的說話者（who）。
        // 立繪留在場上直到換表情、寫「無」或退場：大多數句子立繪欄是空的，每句清空畫面會一直閃。
        // 兩個角色站同一格時，後來的把先來的換下去 —— 沒寫位置的劇本就跟以前的單人立繪一樣
        void ApplyPortraits(StoryNode node, string who, bool instant) {
            if (string.IsNullOrEmpty(node.Portrait) && (node.Stage == null || node.Stage.IsEmpty)) return;
            ParsedStage parsed = StageParser.Parse(node.Stage, node.Portrait);

            foreach (PositionCommand command in parsed.Positions) {
                string w = command.Who ?? who;
                _slotOf[w] = command.Slot;
                if (!_shown.ContainsKey(w)) continue;
                Evict(w, command.Slot);
                _view.MovePortrait(w, command.Slot);
            }

            foreach (PortraitCommand command in parsed.Portraits) {
                string w = command.Who ?? who;
                if (command.Key == null) {
                    if (_shown.Remove(w)) _view.RemovePortrait(w);
                    continue;
                }
                if (_shown.TryGetValue(w, out string current) && current == command.Key) continue;
                if (_portraits == null || !_portraits.TryGet(command.Key, out Sprite sprite)) {
                    Debug.LogWarning($"[StoryPresenter] 立繪對應表裡沒有「{command.Key}」，沿用前一張");
                    continue;
                }
                string slot = SlotOf(w);
                if (!_shown.ContainsKey(w)) Evict(w, slot);
                _view.ShowPortrait(w, sprite, slot);
                _shown[w] = command.Key;
            }

            foreach (PortraitEffectCommand command in parsed.PortraitEffects) {
                string w = command.Who ?? who;
                if (!_shown.ContainsKey(w)) {
                    Debug.LogWarning($"[StoryPresenter] 「{w}」不在場上，立繪效果「{command.Name}」略過");
                    continue;
                }
                bool leaving = command.Name == "淡出" || command.Name.EndsWith("滑出");
                if (leaving) _shown.Remove(w);
                if (instant) { if (leaving) _view.RemovePortrait(w); continue; }
                _view.PlayPortraitEffect(w, command.Name, (float)command.Seconds);
            }
        }

        string SlotOf(string who) => _slotOf.TryGetValue(who, out string slot) ? slot : DefaultSlot;

        void Evict(string who, string slot) {
            var others = new List<string>();
            foreach (string other in _shown.Keys) if (other != who && SlotOf(other) == slot) others.Add(other);
            foreach (string other in others) {
                _shown.Remove(other);
                _view.RemovePortrait(other);
            }
        }

        // 讀檔：照場景裡的排列重播存檔那一句之前的立繪設定（不帶轉場），跟 RestoreStage 一樣是近似值
        void RestorePortraits(string sceneId, string nodeId) {
            var scene = _project.FindScene(sceneId);
            if (scene == null) return;
            foreach (var node in scene.Nodes) {
                if (node.Id == nodeId) break;
                ApplyPortraits(node, _speakers.DisplayName(LabelOf(node.Speaker)), instant: true);
            }
        }

        // ── 查表 ─────────────────────────────────────────────

        string TextOf(Dictionary<string, string> text) =>
            text != null && text.TryGetValue(_lang, out string value) ? value : "";

        // 角色的顯示名就是劇本表人物欄的原字串（mc os、narration、system…），用它判斷種類
        string LabelOf(string speaker) {
            if (string.IsNullOrEmpty(speaker)) return "";
            foreach (var character in _project.Characters) {
                if (character.Id != speaker) continue;
                return character.Name != null && character.Name.TryGetValue(_lang, out string name) ? name : character.Id;
            }
            return speaker;
        }

        string SceneNameOf(string sceneId) => _project.FindScene(sceneId)?.Name ?? sceneId;

        StoryVariable DeclaredOf(string name) => _project.Variables.Find(v => v.Id == name);

        // 給玩家看的標題：屬性名稱 → 說明 → 變數名稱（變數名稱是英數 id，玩家看不懂，只當最後退路）
        static string InputLabelOf(string name, StoryVariable declared) =>
            !string.IsNullOrWhiteSpace(declared?.Label) ? declared.Label.Trim()
            : !string.IsNullOrWhiteSpace(declared?.Description) ? declared.Description
            : name;
    }
}
