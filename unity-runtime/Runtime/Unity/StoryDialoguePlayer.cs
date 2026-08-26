using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using StoryRuntime.Expressions;
using StoryRuntime.Story;
using StoryRuntime.Tags;

namespace StoryRuntime.Unity {

    // 把核心層接到畫面上：逐字顯示、按鍵推進、把立繪與選項丟給遊戲處理。
    //
    // 這裡刻意不碰資產 —— 立繪只以代號字串發出去，由遊戲決定怎麼對應到 Sprite。
    // 理由與變數相同：runtime 一旦開始持有資產查找規則，換一套美術命名就得改 runtime。
    public class StoryDialoguePlayer : MonoBehaviour {

        [Header("資料")]
        public TextAsset StoryFile;

        [Header("畫面")]
        public TMP_Text Label;
        public TMP_Text SpeakerLabel;

        [Header("節奏")]
        public float CharsPerSecond = (float)Typewriter.DefaultCharsPerSecond;

        // 立繪代號（例「居家服-通常」）。沒填立繪的句子不會觸發 ——
        // 視覺小說的慣例是沿用前一張，而實際劇本 789 句裡只有 13 句填了值，
        // 每句都清空的話畫面會一直閃。
        public event Action<string> OnPortraitChanged;
        public event Action<StoryNode> OnLine;
        public event Action<IReadOnlyList<StoryChoice>> OnChoices;
        public event Action<IReadOnlyList<string>> OnInputRequested;
        public event Action OnEnded;
        public event Action<string> OnError;

        public StoryProject Project { get; private set; }
        public PlayerState State { get; private set; }
        public bool IsTyping => _schedule != null && _elapsed < _schedule.Total;

        IStoryVariables _variables;
        TypewriterSchedule _schedule;
        ParsedText _parsed;
        float _elapsed;
        int _revealed;
        string _lastPortrait;

        // ── 開始播放 ──────────────────────────────────────────────

        public void Play(string sceneId, IStoryVariables variables = null) {
            if (StoryFile == null) { Fail("沒有指定 .story.json"); return; }

            Project = StoryLoader.FromJson(StoryFile.text);
            _variables = variables ?? new InMemoryStoryVariables();
            if (variables == null) StoryPlayer.SeedDefaults(Project, _variables);

            _lastPortrait = null;
            State = StoryPlayer.StartScene(Project, sceneId, _variables);
            Present();
        }

        // ── 推進 ──────────────────────────────────────────────────

        // 逐字還沒跑完時先把整句補完，跑完了才真的往下一句 ——
        // 這是視覺小說的標準手感，玩家不必等動畫播完。
        public void Advance() {
            if (State == null) return;
            if (IsTyping) { RevealAll(); return; }
            if (State.Status != PlayerStatus.Line) return;

            State = StoryPlayer.Advance(Project, State, _variables);
            Present();
        }

        public void Choose(string choiceId) {
            if (State == null || State.Status != PlayerStatus.Choices) return;
            State = StoryPlayer.Choose(Project, State, choiceId, _variables);
            Present();
        }

        public void SubmitInput(Dictionary<string, StoryValue> values) {
            if (State == null || State.Status != PlayerStatus.Input) return;
            State = StoryPlayer.SubmitInput(Project, State, values, _variables);
            Present();
        }

        // ── 內部 ──────────────────────────────────────────────────

        void Present() {
            if (State.Status == PlayerStatus.Error) { Fail(State.Error); return; }

            if (State.Status == PlayerStatus.Ended) {
                ClearText();
                OnEnded?.Invoke();
                return;
            }

            StoryNode node = StoryPlayer.CurrentNode(Project, State);
            if (node == null) { Fail($"找不到節點 {State.NodeId}"); return; }

            // 立繪只在「這一句有指定」時才發出，沒指定就沿用前一張。
            if (!string.IsNullOrEmpty(node.Portrait) && node.Portrait != _lastPortrait) {
                _lastPortrait = node.Portrait;
                OnPortraitChanged?.Invoke(node.Portrait);
            }

            if (SpeakerLabel != null) SpeakerLabel.text = SpeakerNameOf(node);

            StartTyping(TextOf(node));

            if (State.Status == PlayerStatus.Choices) OnChoices?.Invoke(node.Choices);
            else if (State.Status == PlayerStatus.Input) OnInputRequested?.Invoke(State.PendingInputs);
            else OnLine?.Invoke(node);
        }

        void StartTyping(string source) {
            // 插值必須在標記解析之前：替換出來的值可能含有標記，
            // 順序反過來那些標記就不會被渲染。
            string filled = Interpolation.Interpolate(source, name =>
                _variables.TryGet(name, out StoryValue value) ? value.ToDisplayString() : null);

            _parsed = TagParser.ParseText(filled, Project.TagRegistry);
            _schedule = Typewriter.Build(_parsed, CharsPerSecond);
            _elapsed = 0;
            _revealed = -1;

            if (Label != null) {
                Label.text = TmpMarkup.CreateDefault().Render(_parsed);
                Label.maxVisibleCharacters = 0;
            }
        }

        void Update() {
            if (_schedule == null || Label == null) return;

            _elapsed += Time.deltaTime;
            int visible = _schedule.VisibleAt(_elapsed);
            if (visible == _revealed) return;

            // 只在數字真的變了才寫回去：maxVisibleCharacters 每次設定都會讓 TMP 重建網格。
            _revealed = visible;
            Label.maxVisibleCharacters = visible;
        }

        void RevealAll() {
            _elapsed = (float)_schedule.Total;
            _revealed = _parsed.Chars.Count;
            if (Label != null) Label.maxVisibleCharacters = _revealed;
        }

        void ClearText() {
            _schedule = null;
            _parsed = null;
            if (Label != null) Label.text = "";
            if (SpeakerLabel != null) SpeakerLabel.text = "";
        }

        string TextOf(StoryNode node) {
            string lang = Project.Meta?.BaseLanguage ?? "zh";
            return node.Text != null && node.Text.TryGetValue(lang, out string text) ? text : "";
        }

        string SpeakerNameOf(StoryNode node) {
            if (string.IsNullOrEmpty(node.Speaker)) return "";
            string lang = Project.Meta?.BaseLanguage ?? "zh";
            foreach (StoryCharacter character in Project.Characters) {
                if (character.Id != node.Speaker) continue;
                return character.Name != null && character.Name.TryGetValue(lang, out string name)
                    ? name : character.Id;
            }
            return node.Speaker;
        }

        void Fail(string message) {
            _schedule = null;
            Debug.LogError($"[StoryDialoguePlayer] {message}");
            OnError?.Invoke(message);
        }
    }

    // 遊戲接上自己的存檔之前的暫代品。正式使用時傳入自己的實作，
    // 否則變數不會被存檔記住（見套件 README 的「變數由遊戲擁有」）。
    public sealed class InMemoryStoryVariables : IStoryVariables {
        readonly Dictionary<string, StoryValue> _values = new Dictionary<string, StoryValue>();
        public bool TryGet(string name, out StoryValue value) => _values.TryGetValue(name, out value);
        public void Set(string name, StoryValue value) => _values[name] = value;
    }
}
