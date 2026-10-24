using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace StoryRuntime.UI {

    // 執行期自建介面的共用零件。預設皮膚整個用程式組出來，套件裡不放 prefab，
    // 換皮的人可以照抄這些零件，也可以完全不用。
    public static class StoryUiKit {

        public static Color Hex(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;

        // ── 畫布 ─────────────────────────────────────────────

        public static Canvas CreateOverlayCanvas(string name, int sortingOrder, Vector2 referenceResolution) {
            var go = new GameObject(name, typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            if (Application.isPlaying) Object.DontDestroyOnLoad(go);
            var canvas = go.GetComponent<Canvas>();
            canvas.renderMode   = RenderMode.ScreenSpaceOverlay;
            canvas.sortingOrder = sortingOrder;
            var scaler = go.GetComponent<CanvasScaler>();
            scaler.uiScaleMode         = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = referenceResolution;
            scaler.matchWidthOrHeight  = 1f;
            return canvas;
        }

        public static RectTransform Rect(string name, Transform parent) {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        public static RectTransform Stretch(RectTransform rt) {
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = Vector2.zero; rt.offsetMax = Vector2.zero;
            return rt;
        }

        // ── 圓角底板 ─────────────────────────────────────────

        static readonly Dictionary<int, Sprite> _rounded = new Dictionary<int, Sprite>();

        // 白色圓角九宮格，半徑以畫布單位計；用 Image.color 上色
        public static Sprite Rounded(float radius) {
            int r = Mathf.Max(1, Mathf.RoundToInt(radius));
            if (_rounded.TryGetValue(r, out var cached) && cached != null) return cached;
            int size = r * 2 + 2;
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[size * size];
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++) {
                float cx = Mathf.Clamp(x + 0.5f, r, size - r), cy = Mathf.Clamp(y + 0.5f, r, size - r);
                float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(cx, cy));
                px[y * size + x] = new Color32(255, 255, 255, (byte)(Mathf.Clamp01(r - d + 0.5f) * 255));
            }
            tex.SetPixels32(px);
            tex.Apply();
            var sprite = Sprite.Create(tex, new UnityEngine.Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100, 0,
                                       SpriteMeshType.FullRect, new Vector4(r, r, r, r));
            _rounded[r] = sprite;
            return sprite;
        }

        public static Image Fill(RectTransform rt, Color color, float radius) {
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = Rounded(radius);
            img.type   = Image.Type.Sliced;
            img.color  = color;
            img.raycastTarget = false;
            return img;
        }

        // 1px 邊框＋底色＋可選的陰影；回傳放內容的那一層
        public static RectTransform Card(RectTransform rt, Color fill, Color border, float radius,
                                         Color? shadow = null, Vector2? shadowOffset = null) {
            Fill(rt, border, radius);
            if (shadow.HasValue) {
                var sh = rt.gameObject.AddComponent<Shadow>();
                sh.effectColor    = shadow.Value;
                sh.effectDistance = shadowOffset ?? new Vector2(0, -4);
            }
            var inner = Stretch(Rect("Fill", rt));
            inner.offsetMin = new Vector2(1, 1); inner.offsetMax = new Vector2(-1, -1);
            Fill(inner, fill, Mathf.Max(1, radius - 1));
            return inner;
        }

        // ── 文字 ─────────────────────────────────────────────

        // size 是畫布單位（不再乘任何倍率）；font 為 null 時用 TMP 的預設字型
        public static TextMeshProUGUI Text(RectTransform parent, string name, string text, float size, Color color,
                                           TMP_FontAsset font, TextAlignmentOptions align = TextAlignmentOptions.Left) {
            var rt = Rect(name, parent);
            var t = rt.gameObject.AddComponent<TextMeshProUGUI>();
            if (font != null) t.font = font;
            t.text = text;
            t.fontSize = size;
            t.color = color;
            t.alignment = align;
            t.raycastTarget = false;
            return t;
        }

        // CSS 的 line-height 倍率 → TMP 的 lineSpacing（在字型原本行高上再加多少 em/100）
        public static float LineSpacingFor(TMP_Text text, float lineHeight) {
            var face = text.font != null ? text.font.faceInfo : default;
            float natural = face.pointSize > 0 ? face.lineHeight / face.pointSize : 1.2f;
            return (lineHeight - natural) * 100;
        }
    }
}
