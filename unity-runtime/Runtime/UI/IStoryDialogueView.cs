using System;
using System.Collections.Generic;
using StoryRuntime.Story;
using StoryRuntime.Tags;
using UnityEngine;

namespace StoryRuntime.UI {

    public readonly struct StoryChoiceItem {
        public readonly string Id;
        public readonly string Markup;
        public StoryChoiceItem(string id, string markup) { Id = id; Markup = markup; }
    }

    public readonly struct StoryInputItem {
        public readonly string Name;
        public readonly string Label;
        public readonly string Placeholder;
        public readonly bool Numeric;
        public StoryInputItem(string name, string label, string placeholder, bool numeric) {
            Name = name; Label = label; Placeholder = placeholder; Numeric = numeric;
        }
    }

    // 對話畫面要提供的東西。Presenter 只認這個介面，換皮就是另寫一個實作；
    // 測試可以換成不畫任何東西的假畫面。
    // 計時（逐字、AUTO 倒數）屬於畫面狀態，由 View 計；「時間到了該做什麼」由 Presenter 決定
    public interface IStoryDialogueView {

        event Action OnAdvanceClick;
        event Action<string> OnChoiceClick;
        event Action<IReadOnlyDictionary<string, string>> OnInputSubmit;
        event Action OnAutoClick;
        // 這一句整句顯示完（逐字跑完或被點擊補完），每次 ShowLine 之後一次
        event Action OnLineShown;
        event Action OnAutoElapsed;
        // 逐字推進到第幾個字（visible 為目前顯示的字數）。點擊補完整句不發，那些字的 [sfx] 就跳過
        event Action<int> OnReveal;

        bool IsTyping { get; }

        void Open();
        void Close();
        void ShowLine(string speaker, string markup, TypewriterSchedule schedule);
        void RevealAll();
        void ShowChoices(IReadOnlyList<StoryChoiceItem> choices);
        void ShowInput(IReadOnlyList<StoryInputItem> fields);
        void ShowInputError(string message);

        // ── 立繪（who 是角色的顯示名，例「店長」；slot 是「左」「中」「右」）──
        // 出現或換表情，不帶轉場；已經在場上而 slot 不同時移過去
        void ShowPortrait(string who, Sprite sprite, string slot);
        void MovePortrait(string who, string slot);
        // 淡入、淡出、左滑入、右滑入、左滑出、右滑出；淡出與滑出播完就移除
        void PlayPortraitEffect(string who, string effect, float seconds);
        void RemovePortrait(string who);
        // 說話的角色站在原位，其他人往下 10px；null = 沒有角色在說話（旁白、內心話）
        void SetSpeaker(string who);

        void SetNarrative(bool narrative);
        void SetAuto(bool on);
        void StartAutoTimer(double seconds);
        void CancelAutoTimer();

        // ── 演出（docs/FORMAT.md §3.5）──
        // 背景：sprite 為 null 代表「無」（全黑）；fade > 0 時交叉淡化
        void SetBackground(Sprite sprite, float fade);
        // 插圖：sprite 為 null 代表收起
        void SetCg(Sprite sprite, float fade);
        // 睜眼、閉眼、黑幕、淡出、淡入、震動、閃白（溶接與 input 由 Presenter 處理，不會傳進來）
        void PlayScreenEffect(ScreenCommand command);
    }
}
