using System;
using System.Collections.Generic;
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

        bool IsTyping { get; }

        void Open();
        void Close();
        void ShowLine(string speaker, string markup, TypewriterSchedule schedule);
        void RevealAll();
        void ShowChoices(IReadOnlyList<StoryChoiceItem> choices);
        void ShowInput(IReadOnlyList<StoryInputItem> fields);
        void ShowInputError(string message);
        void SetPortrait(Sprite sprite);
        void SetPortraitSpeaking(bool speaking);
        void SetNarrative(bool narrative);
        void SetAuto(bool on);
        void StartAutoTimer(double seconds);
        void CancelAutoTimer();
    }
}
