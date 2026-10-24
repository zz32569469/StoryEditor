using System;
using System.Collections.Generic;
using StoryRuntime.Story;
using StoryRuntime.Tags;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace StoryRuntime.UI {

    // 預設對話皮膚，照原型 UI25：底部對話框、左上名稱牌、右上 AUTO、對話框內的分支列表與輸入欄、
    // 右上立繪（非發話者下移）、旁白／內心話的全景情境遮罩。
    // 全部執行期自建；要換皮就另寫一個實作 IStoryDialogueView 的畫面。
    public class StoryDialogueView : MonoBehaviour, IStoryDialogueView {

        public event Action OnAdvanceClick;
        public event Action<string> OnChoiceClick;
        public event Action<IReadOnlyDictionary<string, string>> OnInputSubmit;
        public event Action OnAutoClick;
        public event Action OnLineShown;
        public event Action OnAutoElapsed;
        public event Action<int> OnReveal;

        // 原型以 1024×768 設計；畫布參考解析度 1280×960，尺寸一律 ×1.25
        public const float S = 1.25f;
        public static readonly Vector2 ReferenceResolution = new Vector2(1280, 960);

        public static StoryDialogueView Create(TMP_FontAsset font = null, int sortingOrder = 25) {
            var canvas = StoryUiKit.CreateOverlayCanvas("Story Dialogue Canvas", sortingOrder, ReferenceResolution);
            var view = canvas.gameObject.AddComponent<StoryDialogueView>();
            view._font = font;
            view.Build(canvas.transform);
            return view;
        }

        // ── 尺寸（原型的 px ×S）──────────────────────────────

        public const float Gutter        = 48 * S;    // 對話框左右距
        public const float Bottom        = 22 * S;    // 對話框下距
        public const float MinHeight     = 146 * S;
        public const float MaxHeight     = 310 * S;
        public const float PadY          = 30 * S;
        const float PadX = 26 * S;
        public const float TextMax       = 240 * S;   // 文字區與分支列表各自最高 240，超過就捲動
        const float TextMin = 58 * S, ListMax = TextMax, Gap = 10 * S;
        public const float PortraitWidth = 344 * S;
        public const float PortraitInset = 104 * S;   // 立繪頂距與右距
        // 「右」就是原型 UI25 的單人立繪位置；「左」對稱、「中」置中
        public const float SlotOffset    = 512 * S - PortraitInset - PortraitWidth / 2;
        public const float SlideDistance = 200 * S;   // 滑入滑出的距離
        const float MoveSeconds = 0.3f;
        const float PortraitDropPx = 10 * S;
        const float PortraitEase = 0.2f, ShadeEase = 0.22f;

        // 非發話者往下 10px，發話時回到原位；不調亮度
        public static float PortraitDrop(bool speaking) => speaking ? 0 : PortraitDropPx;

        static readonly Color TextInk    = StoryUiKit.Hex("#574b41");
        static readonly Color CardBorder = StoryUiKit.Hex("#dfcbb8");
        static readonly Color CardFill   = new Color(1, 1, 1, 0.97f);
        static readonly Color CardShadow = StoryUiKit.Hex("#30241b20");
        static readonly Color NameFill   = StoryUiKit.Hex("#ffe0bd");
        static readonly Color NameBorder = StoryUiKit.Hex("#dec2a3");
        static readonly Color NameInk    = StoryUiKit.Hex("#68482f");
        static readonly Color ChoiceFill = StoryUiKit.Hex("#fff7ed");
        static readonly Color ChoiceEdge = StoryUiKit.Hex("#d6c4b1");
        static readonly Color ChoiceInk  = StoryUiKit.Hex("#674c36");
        static readonly Color AutoInkOff = StoryUiKit.Hex("#7a776d");
        static readonly Color AutoInkOn  = StoryUiKit.Hex("#68482f");
        static readonly Color AutoFillOn = StoryUiKit.Hex("#ffe9d2");
        static readonly Color AutoEdgeOn = StoryUiKit.Hex("#dbba98");
        static readonly Color AutoDotOff = StoryUiKit.Hex("#b7b8b2");
        static readonly Color AutoDotOn  = StoryUiKit.Hex("#b77b43");
        static readonly Color NextInk    = StoryUiKit.Hex("#b4865d");
        static readonly Color ErrorInk   = StoryUiKit.Hex("#b4533c");
        static readonly Color MutedInk   = StoryUiKit.Hex("#9a8f84");
        static readonly Color ButtonFill = StoryUiKit.Hex("#f8d4b0");
        static readonly Color ButtonEdge = StoryUiKit.Hex("#d9ad86");
        static readonly Color ButtonInk  = StoryUiKit.Hex("#68472c");
        public static readonly Color ShadeColor = StoryUiKit.Hex("#17222c20");

        // 震動強度 1 = 原型 1024×768 下約 6px
        public const float ShakePixels = 6 * S;

        TMP_FontAsset _font;
        Material _textMaterial;

        RectTransform _root, _stage, _portraitLayer, _card, _nameTag, _auto, _nextRt, _lidTop, _lidBottom;
        CrossfadeLayer _background, _cg;
        Image _curtain, _flash;
        readonly Tween _curtainAlpha = new Tween(), _flashAlpha = new Tween(), _eyes = new Tween(1), _shake = new Tween();
        float _shakeStrength;
        bool _closeEyesToBlack;
        RectTransform _bodyView, _bodyContent, _listView, _listContent, _input, _inputFields;
        Image _shade, _autoFill, _autoEdge, _autoDot, _next;
        TextMeshProUGUI _name, _body, _autoLabel, _inputError;
        ScrollRect _listScroll;

        readonly List<(string name, TMP_InputField field)> _inputs = new List<(string, TMP_InputField)>();

        TypewriterSchedule _schedule;
        float _elapsed;
        int _revealed;
        bool _lineShownPending, _autoOn, _narrative, _layoutDirty;
        float _autoRemaining = -1, _shadeAlpha;
        string _speakerWho;
        readonly List<PortraitActor> _actors = new List<PortraitActor>();

        public bool IsTyping => _schedule != null && _elapsed < _schedule.Total;
        public bool IsOpen => _root != null && _root.gameObject.activeSelf;
        public RectTransform Root => _root;
        public RectTransform Stage => _stage;
        // 測試與換皮檢查用：目前的演出狀態
        public Sprite BackgroundSprite => _background.Current;
        public bool BackgroundIsBlack => _background.IsBlack;
        public Sprite CgSprite => _cg.Current;
        public float CurtainAlpha => _curtainAlpha.Value;
        public float FlashAlpha => _flashAlpha.Value;
        public float EyesOpen => _eyes.Value;
        public RectTransform Card => _card;
        public RectTransform PortraitLayer => _portraitLayer;

        public readonly struct PortraitInfo {
            public readonly string Who, Sprite, Slot;
            public readonly float X, Drop, Alpha;
            public readonly bool Leaving;
            public PortraitInfo(string who, string sprite, string slot, float x, float drop, float alpha, bool leaving) {
                Who = who; Sprite = sprite; Slot = slot; X = x; Drop = drop; Alpha = alpha; Leaving = leaving;
            }
        }

        // 場上的立繪（含正在退場的），依出場順序
        public List<PortraitInfo> Portraits {
            get {
                var list = new List<PortraitInfo>();
                foreach (var a in _actors) {
                    list.Add(new PortraitInfo(a.Who, a.Image.sprite != null ? a.Image.sprite.name : null, a.Slot,
                                              a.X.Value, a.Y, a.Alpha.Value, a.Leaving));
                }
                return list;
            }
        }

        public static float SlotX(string slot) => slot == "左" ? -SlotOffset : slot == "中" ? 0 : SlotOffset;

        // ── 建立 ─────────────────────────────────────────────

        void Build(Transform canvas) {
            // 全畫面點擊即推進，也擋住後面的場景與 HUD；按鈕會先吃掉自己的點擊
            _root = StoryUiKit.Stretch(StoryUiKit.Rect("Story Dialogue", canvas));
            _root.gameObject.AddComponent<Image>().color = Color.clear;
            _root.gameObject.AddComponent<Button>().onClick.AddListener(() => OnAdvanceClick?.Invoke());

            // 所有畫面元素放在 Stage 底下，「震動」時整個畫面（含對話框）一起晃
            _stage = StoryUiKit.Stretch(StoryUiKit.Rect("Stage", _root));

            // 由下而上：背景 → 立繪 → 插圖 → 情境遮罩 → 黑幕 → 眼皮 → 閃白 → 對話框
            _background = new CrossfadeLayer(_stage, "Background");
            _portraitLayer = StoryUiKit.Stretch(StoryUiKit.Rect("Portraits", _stage));

            _cg = new CrossfadeLayer(_stage, "CG");

            // 蓋場景與立繪、不蓋對話框（原型的 0.7px 模糊 uGUI 沒有現成做法，只做色罩）
            _shade = StoryUiKit.Stretch(StoryUiKit.Rect("Narrative Shade", _stage)).gameObject.AddComponent<Image>();
            _shade.raycastTarget = false;
            _shade.color = Color.clear;

            // 黑幕類效果蓋背景與立繪、不蓋對話框：黑畫面上照樣能對話
            _curtain = Overlay("Curtain", Color.black);
            _lidTop = Lid("Eyelid Top", top: true);
            _lidBottom = Lid("Eyelid Bottom", top: false);
            _flash = Overlay("Flash", Color.white);

            _card = StoryUiKit.Rect("Card", _stage);
            _card.anchorMin = Vector2.zero; _card.anchorMax = new Vector2(1, 0); _card.pivot = new Vector2(0.5f, 0);
            _card.offsetMin = new Vector2(Gutter, Bottom);
            _card.offsetMax = new Vector2(-Gutter, Bottom + MinHeight);
            StoryUiKit.Card(_card, CardFill, CardBorder, 14 * S, CardShadow, new Vector2(0, -6 * S));

            BuildBody();
            BuildList();
            BuildInput();
            BuildNameTag();
            BuildAuto();

            // 下一句提示 ▾：不是每套字型都有這個字元，用畫的
            _nextRt = StoryUiKit.Rect("Next", _card);
            _nextRt.anchorMin = _nextRt.anchorMax = _nextRt.pivot = new Vector2(1, 0);
            _nextRt.sizeDelta = new Vector2(11 * S, 7 * S);
            _nextRt.anchoredPosition = new Vector2(-(16 + 10.5f) * S, (7 + 11) * S);
            _next = _nextRt.gameObject.AddComponent<Image>();
            _next.sprite = Caret();
            _next.color = NextInk;
            _next.raycastTarget = false;

            foreach (var text in _root.GetComponentsInChildren<TMP_Text>(true)) Tint(text);
            _root.gameObject.SetActive(false);
        }

        Image Overlay(string name, Color color) {
            var image = StoryUiKit.Stretch(StoryUiKit.Rect(name, _stage)).gameObject.AddComponent<Image>();
            image.raycastTarget = false;
            image.color = new Color(color.r, color.g, color.b, 0);
            return image;
        }

        // 上下兩片黑色眼皮：張開程度 1 時各自縮到畫面外，0 時在中線合起
        RectTransform Lid(string name, bool top) {
            var rt = StoryUiKit.Rect(name, _stage);
            rt.anchorMin = new Vector2(0, top ? 1 : 0);
            rt.anchorMax = new Vector2(1, top ? 1 : 0);
            rt.offsetMin = rt.offsetMax = Vector2.zero;
            var image = rt.gameObject.AddComponent<Image>();
            image.color = Color.black;
            image.raycastTarget = false;
            return rt;
        }

        TextMeshProUGUI Text(RectTransform parent, string name, string text, float px, Color color,
                             TextAlignmentOptions align = TextAlignmentOptions.Left) =>
            StoryUiKit.Text(parent, name, text, px * S, color, _font, align);

        RectTransform ScrollArea(string name, out ScrollRect scroll, out RectTransform content) {
            var view = StoryUiKit.Rect(name, _card);
            view.anchorMin = new Vector2(0, 1); view.anchorMax = Vector2.one; view.pivot = new Vector2(0.5f, 1);
            view.offsetMin = new Vector2(PadX, 0); view.offsetMax = new Vector2(-PadX, 0);
            view.gameObject.AddComponent<Image>().color = Color.clear;   // 讓滾輪打得到；點擊照樣往上傳到全畫面推進
            view.gameObject.AddComponent<RectMask2D>();
            scroll = view.gameObject.AddComponent<ScrollRect>();
            scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped;
            scroll.scrollSensitivity = 24;
            content = StoryUiKit.Rect("Content", view);
            content.anchorMin = new Vector2(0, 1); content.anchorMax = Vector2.one; content.pivot = new Vector2(0.5f, 1);
            content.offsetMin = content.offsetMax = Vector2.zero;
            scroll.viewport = view; scroll.content = content;
            return view;
        }

        void BuildBody() {
            _bodyView = ScrollArea("Body", out _, out _bodyContent);
            _body = Text(_bodyContent, "Text", "", 19, TextInk);
            StoryUiKit.Stretch(_body.rectTransform);
            _body.rectTransform.pivot = new Vector2(0.5f, 1);   // 字元座標從頂端往下算，捲動才算得出最新一行的位置
            _body.alignment = TextAlignmentOptions.TopLeft;
            _body.textWrappingMode = TextWrappingModes.Normal;
            _body.characterSpacing = 0.3f / 19 * 100;
            _body.lineSpacing = StoryUiKit.LineSpacingFor(_body, 1.7f);
        }

        void BuildList() {
            _listView = ScrollArea("Choices", out _listScroll, out _listContent);
            var col = _listContent.gameObject.AddComponent<VerticalLayoutGroup>();
            int pad = Mathf.RoundToInt(2 * S);
            col.padding = new RectOffset(pad, pad, pad, pad);
            col.spacing = 7 * S;
            col.childControlWidth = col.childControlHeight = true;
            col.childForceExpandWidth = true; col.childForceExpandHeight = false;
            _listContent.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            _listView.gameObject.SetActive(false);
        }

        void BuildInput() {
            _input = StoryUiKit.Rect("Input", _card);
            _input.anchorMin = new Vector2(0, 1); _input.anchorMax = Vector2.one; _input.pivot = new Vector2(0.5f, 1);
            _input.offsetMin = new Vector2(PadX, 0); _input.offsetMax = new Vector2(-PadX, 0);
            var col = _input.gameObject.AddComponent<VerticalLayoutGroup>();
            col.spacing = 8 * S;
            col.childControlWidth = col.childControlHeight = true;
            col.childForceExpandWidth = true; col.childForceExpandHeight = false;

            _inputFields = StoryUiKit.Rect("Fields", _input);
            var fieldsCol = _inputFields.gameObject.AddComponent<VerticalLayoutGroup>();
            fieldsCol.spacing = 8 * S;
            fieldsCol.childControlWidth = fieldsCol.childControlHeight = true;
            fieldsCol.childForceExpandWidth = true; fieldsCol.childForceExpandHeight = false;

            _inputError = Text(_input, "Error", "", 13, ErrorInk);

            var footer = StoryUiKit.Rect("Footer", _input);
            var row = footer.gameObject.AddComponent<HorizontalLayoutGroup>();
            row.childAlignment = TextAnchor.MiddleRight;
            row.childControlWidth = row.childControlHeight = false;
            footer.gameObject.AddComponent<LayoutElement>().preferredHeight = 34 * S;
            ConfirmButton(footer, "確定", new Vector2(110 * S, 34 * S)).onClick.AddListener(SubmitInput);

            _input.gameObject.SetActive(false);
        }

        Button ConfirmButton(RectTransform parent, string label, Vector2 size) {
            var rt = StoryUiKit.Rect(label, parent);
            rt.sizeDelta = size;
            var inner = StoryUiKit.Card(rt, ButtonFill, ButtonEdge, 11 * S);
            rt.GetComponent<Image>().raycastTarget = true;
            var btn = rt.gameObject.AddComponent<Button>();
            btn.targetGraphic = inner.GetComponent<Image>();
            var t = Text(inner, "Label", label, 15, ButtonInk, TextAlignmentOptions.Center);
            StoryUiKit.Stretch(t.rectTransform);
            return btn;
        }

        void BuildNameTag() {
            // 名稱牌高 32、跨在對話框上緣（原型 top:-16px、left:22px）
            _nameTag = StoryUiKit.Rect("Name Tag", _card);
            _nameTag.anchorMin = _nameTag.anchorMax = new Vector2(0, 1);
            _nameTag.pivot = new Vector2(0, 0.5f);
            _nameTag.anchoredPosition = new Vector2(22 * S, 0);
            var inner = StoryUiKit.Card(_nameTag, NameFill, NameBorder, 9 * S);
            _name = Text(inner, "Name", "", 15, NameInk, TextAlignmentOptions.Center);
            _name.fontStyle = FontStyles.Bold;
            _name.characterSpacing = 1f / 15 * 100;
            StoryUiKit.Stretch(_name.rectTransform);
        }

        void BuildAuto() {
            // 對話框右上（右距 22、頂距 −14、高 28），一律顯示「AUTO」，以按下狀態區別開關
            _auto = StoryUiKit.Rect("Auto", _card);
            _auto.anchorMin = _auto.anchorMax = _auto.pivot = Vector2.one;
            _auto.anchoredPosition = new Vector2(-22 * S, 14 * S);
            var inner = StoryUiKit.Card(_auto, Color.white, CardBorder, 8 * S);
            _autoEdge = _auto.GetComponent<Image>();
            _autoEdge.raycastTarget = true;
            _autoFill = inner.GetComponent<Image>();
            var btn = _auto.gameObject.AddComponent<Button>();
            btn.transition = Selectable.Transition.None;
            btn.onClick.AddListener(() => OnAutoClick?.Invoke());

            var dot = StoryUiKit.Rect("Dot", inner);
            dot.anchorMin = dot.anchorMax = dot.pivot = new Vector2(0, 0.5f);
            dot.sizeDelta = new Vector2(5 * S, 5 * S);
            dot.anchoredPosition = new Vector2(11 * S, 0);
            _autoDot = StoryUiKit.Fill(dot, AutoDotOff, 2.5f * S);

            _autoLabel = Text(inner, "Label", "AUTO", 11, AutoInkOff);
            _autoLabel.fontStyle = FontStyles.Bold;
            _autoLabel.characterSpacing = 0.7f / 11 * 100;
            _autoLabel.alignment = TextAlignmentOptions.MidlineLeft;
            var label = _autoLabel.rectTransform;
            label.anchorMin = Vector2.zero; label.anchorMax = Vector2.one;
            label.offsetMin = new Vector2((11 + 5 + 6) * S, 0); label.offsetMax = new Vector2(-11 * S, 0);

            float width = (11 + 5 + 6 + 11) * S + _autoLabel.GetPreferredValues("AUTO").x + 2;
            _auto.sizeDelta = new Vector2(width, 28 * S);
            SetAuto(false);
        }

        // ── IStoryDialogueView ───────────────────────────────

        public void Open() {
            _root.gameObject.SetActive(true);
            // 每次開始對話都從乾淨的舞台開始：沒有背景（透出後面的遊戲畫面）、沒有插圖與黑幕
            _background.Clear();
            _cg.Clear();
            _curtainAlpha.Set(0);
            _flashAlpha.Set(0);
            _eyes.Set(1);
            _shake.Set(0);
            _closeEyesToBlack = false;
            _narrative = false;
            _shadeAlpha = 0;
            _shade.color = Color.clear;
            ClearPortraits();
        }

        public void Close() {
            _schedule = null;
            _lineShownPending = false;
            _autoRemaining = -1;
            _body.text = "";
            ClearPortraits();
            ShowChoices(Array.Empty<StoryChoiceItem>());
            ShowInput(Array.Empty<StoryInputItem>());
            _root.gameObject.SetActive(false);
        }

        public void ShowLine(string speaker, string markup, TypewriterSchedule schedule) {
            _nameTag.gameObject.SetActive(!string.IsNullOrEmpty(speaker));
            _name.text = speaker;
            float tagWidth = Mathf.Max(78 * S, _name.GetPreferredValues(speaker).x + 32 * S + 2);
            _nameTag.sizeDelta = new Vector2(tagWidth, 32 * S);

            _body.text = markup;
            _schedule = schedule;
            _elapsed = 0;
            _revealed = 0;
            _body.maxVisibleCharacters = 0;
            _bodyContent.anchoredPosition = Vector2.zero;
            _lineShownPending = true;
            _autoRemaining = -1;
            _layoutDirty = true;
        }

        public void RevealAll() {
            if (_schedule == null) return;
            _elapsed = (float)_schedule.Total;
            SetRevealed(_schedule.Times.Count, typing: false);
        }

        public void SetBackground(Sprite sprite, float fade) => _background.Show(sprite, fade, blackWhenNull: true);
        public void SetCg(Sprite sprite, float fade) => _cg.Show(sprite, fade, blackWhenNull: false);

        public void PlayScreenEffect(ScreenCommand command) {
            float seconds = command.Args.Count > 0 ? (float)command.Args[0] : 0;
            switch (command.Name) {
                case "黑幕":
                    _curtainAlpha.Set(1);
                    break;
                case "淡出":
                    _curtainAlpha.To(1, seconds);
                    break;
                case "淡入":
                    _curtainAlpha.Set(1);
                    _curtainAlpha.To(0, seconds);
                    break;
                case "睜眼":
                    // 眼皮從合起開始張開；底下的黑幕同時拿掉，張開後看到的是畫面
                    _curtainAlpha.Set(0);
                    _eyes.Set(0);
                    _eyes.To(1, seconds);
                    _closeEyesToBlack = false;
                    break;
                case "閉眼":
                    _eyes.To(0, seconds);
                    _closeEyesToBlack = true;   // 闔起後換成黑幕，之後的淡入／睜眼才接得上
                    break;
                case "震動":
                    _shakeStrength = command.Args.Count > 1 ? (float)command.Args[1] : 1;
                    _shake.Set(1);
                    _shake.To(0, seconds);
                    break;
                case "閃白":
                    _flashAlpha.Set(1);
                    _flashAlpha.To(0, seconds);
                    break;
                default:
                    Debug.LogWarning($"[StoryDialogueView] 不支援的畫面效果「{command.Name}」");
                    break;
            }
        }

        public void ShowChoices(IReadOnlyList<StoryChoiceItem> choices) {
            Clear(_listContent);
            foreach (var choice in choices) CreateChoice(choice);
            _listView.gameObject.SetActive(choices.Count > 0);
            _listScroll.verticalNormalizedPosition = 1;
            _layoutDirty = true;
        }

        public void ShowInput(IReadOnlyList<StoryInputItem> fields) {
            Clear(_inputFields);
            _inputs.Clear();
            _inputError.text = "";
            foreach (var f in fields) _inputs.Add((f.Name, CreateField(f)));
            _input.gameObject.SetActive(fields.Count > 0);
            if (_inputs.Count > 0) _inputs[0].field.ActivateInputField();
            _layoutDirty = true;
        }

        public void ShowInputError(string message) {
            _inputError.text = message;
            _layoutDirty = true;
        }

        // ── 立繪 ─────────────────────────────────────────────

        public void ShowPortrait(string who, Sprite sprite, string slot) {
            var actor = Find(who);
            if (actor == null) {
                actor = new PortraitActor(who, _portraitLayer, slot, PortraitDrop(who == _speakerWho));
                _actors.Add(actor);
            } else if (actor.Leaving) {
                // 退場途中又叫回來：停在目前位置，淡回來
                actor.Leaving = false;
                actor.Alpha.To(1, MoveSeconds);
            }
            actor.Image.sprite = sprite;
            // 寬 344、高度照原圖比例
            float aspect = sprite.rect.height / Mathf.Max(1, sprite.rect.width);
            actor.Rt.sizeDelta = new Vector2(PortraitWidth, PortraitWidth * aspect);
            if (actor.Slot != slot) MovePortrait(who, slot);
        }

        public void MovePortrait(string who, string slot) {
            var actor = Find(who);
            if (actor == null || actor.Leaving) return;
            actor.Slot = slot;
            actor.X.To(SlotX(slot), MoveSeconds);
        }

        public void PlayPortraitEffect(string who, string effect, float seconds) {
            var actor = Find(who);
            if (actor == null) return;
            float home = SlotX(actor.Slot);
            switch (effect) {
                case "淡入":
                    actor.Leaving = false;
                    actor.X.Set(home);
                    actor.Alpha.Set(0); actor.Alpha.To(1, seconds);
                    break;
                case "左滑入":
                case "右滑入":
                    actor.Leaving = false;
                    actor.X.Set(home + (effect == "左滑入" ? -SlideDistance : SlideDistance)); actor.X.To(home, seconds);
                    actor.Alpha.Set(0); actor.Alpha.To(1, seconds);
                    break;
                case "淡出":
                    actor.Leaving = true;
                    actor.Alpha.To(0, seconds);
                    break;
                case "左滑出":
                case "右滑出":
                    actor.Leaving = true;
                    actor.X.To(actor.X.Value + (effect == "左滑出" ? -SlideDistance : SlideDistance), seconds);
                    actor.Alpha.To(0, seconds);
                    break;
            }
        }

        public void RemovePortrait(string who) {
            var actor = Find(who);
            if (actor == null) return;
            _actors.Remove(actor);
            Destroy(actor.Rt.gameObject);
        }

        public void SetSpeaker(string who) => _speakerWho = who;

        void ClearPortraits() {
            foreach (var actor in _actors) Destroy(actor.Rt.gameObject);
            _actors.Clear();
            _speakerWho = null;
        }

        PortraitActor Find(string who) => _actors.Find(a => a.Who == who);

        void UpdatePortraits(float dt) {
            for (int i = _actors.Count - 1; i >= 0; i -= 1) {
                var actor = _actors[i];
                actor.X.Tick(dt);
                actor.Alpha.Tick(dt);
                // 發話者位移 200ms
                actor.Y = Mathf.MoveTowards(actor.Y, PortraitDrop(actor.Who == _speakerWho), PortraitDropPx / PortraitEase * dt);
                actor.Rt.anchoredPosition = new Vector2(actor.X.Value, -PortraitInset - actor.Y);
                SetAlpha(actor.Image, actor.Alpha.Value);
                if (actor.Leaving && actor.Alpha.Done) {
                    _actors.RemoveAt(i);
                    Destroy(actor.Rt.gameObject);
                }
            }
        }

        sealed class PortraitActor {
            public readonly string Who;
            public readonly RectTransform Rt;
            public readonly Image Image;
            public readonly Tween X, Alpha = new Tween(1);
            public string Slot;
            public float Y;
            public bool Leaving;

            public PortraitActor(string who, RectTransform layer, string slot, float drop) {
                Who = who;
                Slot = slot;
                Y = drop;   // 一出場就在定位，不從別處滑過來
                X = new Tween(SlotX(slot));
                Rt = StoryUiKit.Rect(who, layer);
                Rt.anchorMin = Rt.anchorMax = Rt.pivot = new Vector2(0.5f, 1);
                Rt.anchoredPosition = new Vector2(X.Value, -PortraitInset - Y);
                Image = Rt.gameObject.AddComponent<Image>();
                Image.preserveAspect = true;
                Image.raycastTarget = false;
            }
        }
        public void SetNarrative(bool narrative) => _narrative = narrative;

        public void SetAuto(bool on) {
            _autoOn = on;
            _autoFill.color  = on ? AutoFillOn : Color.white;
            _autoEdge.color  = on ? AutoEdgeOn : CardBorder;
            _autoLabel.color = on ? AutoInkOn : AutoInkOff;
            _autoDot.color   = on ? AutoDotOn : AutoDotOff;
        }

        public void StartAutoTimer(double seconds) => _autoRemaining = (float)seconds;
        public void CancelAutoTimer() => _autoRemaining = -1;

        // ── 內部 ─────────────────────────────────────────────

        // 有些字型資產的材質把 Face Color 設成黑色，TMP 會把文字顏色乘上它而全部變黑灰。
        // 對話畫面自己用一份白色 Face Color 的副本，不動共用材質
        void Tint(TMP_Text text) {
            if (_textMaterial == null) {
                _textMaterial = new Material(text.fontSharedMaterial) { name = "Story Dialogue Text" };
                _textMaterial.SetColor(ShaderUtilities.ID_FaceColor, Color.white);
            }
            text.fontSharedMaterial = _textMaterial;
        }

        // Destroy 要到這一幀結束才生效，先關掉，同一幀的版面計算才不會把舊的算進去
        static void Clear(RectTransform parent) {
            foreach (Transform child in parent) {
                child.gameObject.SetActive(false);
                Destroy(child.gameObject);
            }
        }

        static Sprite _caret;

        // 朝下的小三角形（▾），白色、用 Image.color 上色
        static Sprite Caret() {
            if (_caret != null) return _caret;
            const int w = 22, h = 14;
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[w * h];
            for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) {
                // 頂邊在上（y = h），尖端在下中央（y = 0）
                float half = (y + 0.5f) / h * (w / 2f);
                float d = half - Mathf.Abs(x + 0.5f - w / 2f);
                px[y * w + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(d + 0.5f) * 255));
            }
            tex.SetPixels32(px);
            tex.Apply();
            _caret = Sprite.Create(tex, new UnityEngine.Rect(0, 0, w, h), new Vector2(0.5f, 0.5f));
            return _caret;
        }

        void CreateChoice(StoryChoiceItem item) {
            var rt = StoryUiKit.Rect(item.Id, _listContent);
            var inner = StoryUiKit.Card(rt, ChoiceFill, ChoiceEdge, 10 * S);
            rt.GetComponent<Image>().raycastTarget = true;
            var btn = rt.gameObject.AddComponent<Button>();
            btn.targetGraphic = inner.GetComponent<Image>();
            var colors = btn.colors;
            colors.highlightedColor = new Color(1f, 0.923f, 0.843f);   // #fff7ed → hover #ffe4c6
            colors.pressedColor     = new Color(1f, 1f, 1f, 0.65f);
            colors.selectedColor    = Color.white;
            btn.colors = colors;
            string id = item.Id;
            btn.onClick.AddListener(() => OnChoiceClick?.Invoke(id));

            var label = Text(inner, "Label", item.Markup, 16, ChoiceInk, TextAlignmentOptions.MidlineLeft);
            Tint(label);
            label.textWrappingMode = TextWrappingModes.Normal;
            label.lineSpacing = StoryUiKit.LineSpacingFor(label, 1.5f);
            StoryUiKit.Stretch(label.rectTransform);
            label.rectTransform.offsetMin = new Vector2(14 * S, 7 * S);
            label.rectTransform.offsetMax = new Vector2(-14 * S, -7 * S);
            rt.gameObject.AddComponent<LayoutElement>().minHeight = 38 * S;
        }

        TMP_InputField CreateField(StoryInputItem item) {
            var group = StoryUiKit.Rect(item.Name, _inputFields);
            var groupCol = group.gameObject.AddComponent<VerticalLayoutGroup>();
            groupCol.spacing = 4 * S;
            groupCol.childControlWidth = groupCol.childControlHeight = true;
            groupCol.childForceExpandWidth = true; groupCol.childForceExpandHeight = false;
            Tint(Text(group, "Label", item.Label, 14, TextInk));

            // TMP_InputField 在 OnEnable 就要拿到文字元件，先關著組好再打開
            var rt = StoryUiKit.Rect("Field", group);
            rt.gameObject.SetActive(false);
            rt.gameObject.AddComponent<LayoutElement>().preferredHeight = 36 * S;
            StoryUiKit.Card(rt, ChoiceFill, ChoiceEdge, 8 * S);
            var bg = rt.GetComponent<Image>();
            bg.raycastTarget = true;

            var area = StoryUiKit.Stretch(StoryUiKit.Rect("Text Area", rt));
            area.offsetMin = new Vector2(12 * S, 4 * S); area.offsetMax = new Vector2(-12 * S, -4 * S);
            area.gameObject.AddComponent<RectMask2D>();
            var placeholder = Text(area, "Placeholder", item.Placeholder, 15, MutedInk);
            StoryUiKit.Stretch(placeholder.rectTransform);
            placeholder.alignment = TextAlignmentOptions.MidlineLeft;
            var text = Text(area, "Text", "", 15, TextInk);
            Tint(placeholder);
            Tint(text);
            StoryUiKit.Stretch(text.rectTransform);
            text.alignment = TextAlignmentOptions.MidlineLeft;

            var field = rt.gameObject.AddComponent<TMP_InputField>();
            field.textViewport  = area;
            field.textComponent = text;
            field.placeholder   = placeholder;
            field.targetGraphic = bg;
            if (_font != null) field.fontAsset = _font;
            field.contentType   = item.Numeric ? TMP_InputField.ContentType.IntegerNumber : TMP_InputField.ContentType.Standard;
            field.onSubmit.AddListener(_ => SubmitInput());
            rt.gameObject.SetActive(true);
            return field;
        }

        void SubmitInput() {
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (name, field) in _inputs) values[name] = field.text;
            OnInputSubmit?.Invoke(values);
        }

        void SetRevealed(int visible, bool typing = true) {
            if (visible == _revealed) return;
            // 只在數字變了才寫回：maxVisibleCharacters 每次設定都會讓 TMP 重建網格
            _revealed = visible;
            _body.maxVisibleCharacters = visible;
            FollowTyping();
            if (typing) OnReveal?.Invoke(visible);
        }

        // 長文捲動：讓剛出現的那一行保持在可視範圍內
        void FollowTyping() {
            if (_revealed <= 0 || _body.textInfo == null || _body.textInfo.characterCount < _revealed) return;
            float lineBottom = -_body.textInfo.characterInfo[_revealed - 1].descender;
            float viewH = _bodyView.rect.height;
            _bodyContent.anchoredPosition = new Vector2(0, Mathf.Max(0, lineBottom - viewH));
        }

        // 對話框高度依內容：最小 146、最大 310；文字與分支列表各自最多 240，超過就捲動
        void Relayout() {
            _layoutDirty = false;
            bool hasList = _listView.gameObject.activeSelf, hasInput = _input.gameObject.activeSelf;
            bool hasBody = !string.IsNullOrEmpty(_body.text) || (!hasList && !hasInput);
            _bodyView.gameObject.SetActive(hasBody);
            _nextRt.gameObject.SetActive(!hasList && !hasInput);

            float width = _bodyView.rect.width > 0 ? _bodyView.rect.width : _card.rect.width - PadX * 2;
            float y = PadY;

            if (hasBody) {
                float textH = _body.GetPreferredValues(_body.text, width, 0).y;
                _bodyContent.sizeDelta = new Vector2(0, textH);
                float viewH = Mathf.Clamp(textH, TextMin, ListMax);
                if (hasList || hasInput) viewH = Mathf.Min(viewH, Mathf.Max(TextMin, MaxHeight - PadY * 2 - Gap - TextMin));
                Place(_bodyView, y, viewH);
                y += viewH + ((hasList || hasInput) ? Gap : 0);
            }
            if (hasList) {
                LayoutRebuilder.ForceRebuildLayoutImmediate(_listContent);
                float listH = Mathf.Min(LayoutUtility.GetPreferredHeight(_listContent), ListMax, MaxHeight - PadY - y);
                Place(_listView, y, listH);
                y += listH;
            }
            if (hasInput) {
                LayoutRebuilder.ForceRebuildLayoutImmediate(_input);
                float inputH = LayoutUtility.GetPreferredHeight(_input);
                Place(_input, y, inputH);
                y += inputH;
            }

            float height = Mathf.Clamp(y + PadY, MinHeight, hasInput ? Mathf.Max(MaxHeight, y + PadY) : MaxHeight);
            _card.offsetMax = new Vector2(-Gutter, Bottom + height);
        }

        static void Place(RectTransform rt, float top, float height) {
            rt.anchoredPosition = new Vector2(0, -top);
            rt.sizeDelta = new Vector2(rt.sizeDelta.x, height);
        }

        void Update() {
            if (!IsOpen) return;
            float dt = Time.unscaledDeltaTime;

            if (_schedule != null && _elapsed < _schedule.Total) {
                _elapsed += dt;
                SetRevealed(_schedule.VisibleAt(_elapsed));
            }
            if (_lineShownPending && !IsTyping) {
                _lineShownPending = false;
                OnLineShown?.Invoke();
            }
            if (_autoRemaining >= 0) {
                _autoRemaining -= dt;
                if (_autoRemaining < 0) OnAutoElapsed?.Invoke();
            }

            var next = _next.color;
            next.a = IsTyping ? 0.35f : 1;
            _next.color = next;

            UpdatePortraits(dt);
            // 遮罩淡入淡出 220ms
            _shadeAlpha = Mathf.MoveTowards(_shadeAlpha, _narrative ? 1 : 0, dt / ShadeEase);
            var shade = ShadeColor;
            shade.a *= _shadeAlpha;
            _shade.color = shade;

            UpdateStage(dt);

            if (!_input.gameObject.activeSelf) ReadKeys();   // 輸入欄開著時鍵盤歸輸入框
        }

        // 只接舊版 Input Manager：專案只開新版 Input System 時呼叫 Input.GetKeyDown 會丟例外，
        // 那種專案請另外把按鍵接到 Advance 之類的事件上
        void ReadKeys() {
#if ENABLE_LEGACY_INPUT_MANAGER
            if (Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter))
                OnAdvanceClick?.Invoke();
            if (Input.GetKeyDown(KeyCode.Escape) && _autoOn) OnAutoClick?.Invoke();   // Esc 關掉 AUTO
#endif
        }

        void UpdateStage(float dt) {
            _background.Update(dt);
            _cg.Update(dt);
            _curtainAlpha.Tick(dt);
            _flashAlpha.Tick(dt);
            _eyes.Tick(dt);
            _shake.Tick(dt);

            if (_closeEyesToBlack && _eyes.Done && _eyes.Value <= 0) {
                _closeEyesToBlack = false;
                _curtainAlpha.Set(1);
                _eyes.Set(1);
            }

            SetAlpha(_curtain, _curtainAlpha.Value);
            SetAlpha(_flash, _flashAlpha.Value);

            // 眼皮：張開程度 0 → 各蓋半個畫面；用平滑曲線，張開的頭尾慢、中段快
            float open = Mathf.SmoothStep(0, 1, _eyes.Value);
            float half = _stage.rect.height / 2 * (1 - open);
            _lidTop.sizeDelta = new Vector2(0, half);
            _lidTop.pivot = new Vector2(0.5f, 1);
            _lidTop.anchoredPosition = Vector2.zero;
            _lidBottom.sizeDelta = new Vector2(0, half);
            _lidBottom.pivot = new Vector2(0.5f, 0);
            _lidBottom.anchoredPosition = Vector2.zero;

            float amp = _shake.Value * _shakeStrength * ShakePixels;
            _stage.anchoredPosition = amp > 0.01f
                ? new Vector2(UnityEngine.Random.Range(-amp, amp), UnityEngine.Random.Range(-amp, amp))
                : Vector2.zero;
        }

        static void SetAlpha(Image image, float alpha) {
            var c = image.color;
            c.a = alpha;
            image.color = c;
        }

        // 線性補間的數值，給黑幕、閃白、眼皮、震動用
        sealed class Tween {
            float _from, _to, _duration, _elapsed;
            public float Value { get; private set; }
            public bool Done => _elapsed >= _duration;

            public Tween(float value = 0) { Set(value); }

            public void Set(float value) {
                Value = _from = _to = value;
                _duration = _elapsed = 0;
            }

            public void To(float target, float seconds) {
                _from = Value;
                _to = target;
                _duration = Mathf.Max(0, seconds);
                _elapsed = 0;
                if (_duration <= 0) Value = target;
            }

            public void Tick(float dt) {
                if (_elapsed >= _duration) return;
                _elapsed += dt;
                Value = Mathf.Lerp(_from, _to, Mathf.Clamp01(_elapsed / _duration));
            }
        }

        // 背景與插圖：兩張圖輪流，換圖時新圖在上淡入（溶接），淡入完成才把舊圖藏起來
        sealed class CrossfadeLayer {
            readonly Image[] _images = new Image[2];
            int _front;
            float _fade, _elapsed;

            public Sprite Current { get; private set; }
            public bool IsBlack { get; private set; }

            public CrossfadeLayer(RectTransform parent, string name) {
                var root = StoryUiKit.Stretch(StoryUiKit.Rect(name, parent));
                for (int i = 0; i < 2; i += 1) {
                    var image = StoryUiKit.Stretch(StoryUiKit.Rect($"{name} {i}", root)).gameObject.AddComponent<Image>();
                    image.preserveAspect = true;
                    image.raycastTarget = false;
                    image.enabled = false;
                    _images[i] = image;
                }
            }

            public void Clear() {
                foreach (var image in _images) image.enabled = false;
                Current = null;
                IsBlack = false;
                _fade = _elapsed = 0;
            }

            // sprite 為 null：背景換成全黑（blackWhenNull）、插圖收起
            public void Show(Sprite sprite, float fade, bool blackWhenNull) {
                Current = sprite;
                IsBlack = sprite == null && blackWhenNull;
                _front = 1 - _front;
                var next = _images[_front];
                next.transform.SetAsLastSibling();
                next.sprite = sprite;
                next.preserveAspect = sprite != null;
                next.enabled = sprite != null || blackWhenNull;
                var color = sprite != null ? Color.white : Color.black;
                color.a = fade > 0 ? 0 : 1;
                next.color = color;
                _fade = fade;
                _elapsed = 0;
                if (fade <= 0) _images[1 - _front].enabled = false;
                else if (sprite == null && !blackWhenNull) {
                    // 收起插圖也要淡出：讓舊圖淡掉，而不是新圖淡入
                    next.enabled = false;
                }
            }

            public void Update(float dt) {
                if (_elapsed >= _fade) return;
                _elapsed += dt;
                float t = Mathf.Clamp01(_elapsed / _fade);
                var next = _images[_front];
                var prev = _images[1 - _front];
                if (next.enabled) SetAlpha(next, t);
                else SetAlpha(prev, 1 - t);
                if (t >= 1) prev.enabled = false;
            }
        }

        void LateUpdate() {
            if (IsOpen && _layoutDirty) Relayout();
        }

        void OnDestroy() {
            if (_textMaterial != null) Destroy(_textMaterial);
        }
    }
}
