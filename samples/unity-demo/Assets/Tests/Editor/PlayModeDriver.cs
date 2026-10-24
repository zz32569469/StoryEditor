using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using StoryRuntime.UI;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

namespace StoryDemo.Tests {

    // batch mode 沒有 Game 視窗可截，改把畫布切到 Screen Space - Camera，用相機畫進 1280×960 的 RenderTexture
    public sealed class Screenshotter {
        readonly Camera _camera;
        readonly RenderTexture _target;
        readonly string _dir;
        public int Count;

        public Screenshotter(string dir, List<Object> objects, Sprite background = null) {
            _dir = dir;
            Directory.CreateDirectory(dir);
            foreach (var old in Directory.GetFiles(dir, "*.png")) File.Delete(old);

            _target = new RenderTexture(1280, 960, 24);
            _camera = new GameObject("Screenshot Camera").AddComponent<Camera>();
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0.3f, 0.3f, 0.3f);
            _camera.targetTexture = _target;
            objects.Add(_camera.gameObject); objects.Add(_target);

            if (background != null) {
                var bg = DemoBootstrap.CreateBackground(background);
                bg.renderMode = RenderMode.ScreenSpaceCamera;
                bg.worldCamera = _camera;
                bg.planeDistance = 50;
                objects.Add(bg.gameObject);
            }

            var dialogue = GameObject.Find("Story Dialogue Canvas").GetComponent<Canvas>();
            dialogue.renderMode = RenderMode.ScreenSpaceCamera;
            dialogue.worldCamera = _camera;
            dialogue.planeDistance = 10;
        }

        public void Take(string name) {
            Canvas.ForceUpdateCanvases();
            _camera.Render();
            var prev = RenderTexture.active;
            RenderTexture.active = _target;
            var tex = new Texture2D(_target.width, _target.height, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, _target.width, _target.height), 0, 0);
            tex.Apply();
            RenderTexture.active = prev;
            File.WriteAllBytes(Path.Combine(_dir, $"{++Count:00}-{name}.png"), tex.EncodeToPNG());
            Object.Destroy(tex);
        }
    }

    // 一句台詞在某個時間點的畫面狀態
    public sealed class LineSnapshot {
        public string Text, Speaker, Background, Cg;
        public bool BackgroundBlack, Narrative;
        public float Curtain, Eyes, Flash, CardHeight, PortraitDrop, Scroll, ShadeAlpha;
        public Vector2 Shake;
    }

    public sealed class UiLog {
        public readonly List<string> Lines = new List<string>();
        public readonly List<string> Speakers = new List<string>();
        public readonly List<int> ChoiceCounts = new List<int>();
        public readonly List<LineSnapshot> Early = new List<LineSnapshot>();
        public readonly List<LineSnapshot> Settled = new List<LineSnapshot>();
        public bool SawPartialTyping;
    }

    // 每一幀看畫面上有什麼就做什麼：輸入欄就填、選項就點第一個、台詞就等它整句出現再點下一句。
    // 每句記兩次狀態：剛出現 0.12 秒（抓得到進行中的轉場與效果）與整句出現後 0.35 秒（動畫跑完）
    public static class PlayModeDriver {

        public static RectTransform Root() =>
            (RectTransform)GameObject.Find("Story Dialogue Canvas").transform.Find("Story Dialogue");

        public static IEnumerator Drive(Func<bool> finished, UiLog log, Dictionary<string, string> inputs,
                                        Screenshotter shots, float timeout = 90f, Func<int, bool> shootEarly = null) {
            float started = Time.realtimeSinceStartup;
            string lastBody = null;
            int settledFrames = 0;
            bool recorded = false;

            while (!finished() && Time.realtimeSinceStartup - started < timeout) {
                yield return null;
                var canvas = GameObject.Find("Story Dialogue Canvas");
                if (canvas == null) continue;
                var root = Root();
                if (!root.gameObject.activeSelf) continue;
                var view = canvas.GetComponent<StoryDialogueView>();
                var card = (RectTransform)root.Find("Stage/Card");

                var input = card.Find("Input");
                if (input.gameObject.activeSelf) {
                    yield return new WaitForSecondsRealtime(0.3f);
                    shots?.Take("input");
                    foreach (var field in input.GetComponentsInChildren<TMP_InputField>()) {
                        string name = field.transform.parent.name;
                        Assert.IsTrue(inputs.ContainsKey(name), $"沒準備「{name}」的輸入值");
                        field.text = inputs[name];
                    }
                    input.GetComponentsInChildren<Button>().First(b => b.name == "確定").onClick.Invoke();
                    continue;
                }

                var choices = card.Find("Choices/Content");
                if (choices.parent.gameObject.activeSelf && choices.childCount > 0) {
                    yield return new WaitForSecondsRealtime(0.3f);
                    shots?.Take("choices");
                    log.ChoiceCounts.Add(choices.Cast<Transform>().Count(c => c.gameObject.activeSelf));
                    choices.GetChild(0).GetComponent<Button>().onClick.Invoke();
                    continue;
                }

                var body = card.Find("Body/Content/Text").GetComponent<TextMeshProUGUI>();
                if (body.text != lastBody) {
                    lastBody = body.text;
                    settledFrames = 0;
                    recorded = false;
                    if (body.text.Length == 0) continue;
                    log.Lines.Add(Regex.Replace(body.text, "<[^>]*>", ""));
                    var tag = card.Find("Name Tag");
                    log.Speakers.Add(tag.gameObject.activeSelf ? tag.GetComponentInChildren<TextMeshProUGUI>().text : "");
                    yield return new WaitForSecondsRealtime(0.12f);
                    log.Early.Add(Snapshot(view, root, card, lastBody));
                    if (shootEarly != null && shootEarly(log.Lines.Count - 1)) shots?.Take($"line{log.Lines.Count:00}-early");
                    continue;
                }
                bool typing = body.maxVisibleCharacters < body.textInfo.characterCount;
                if (body.maxVisibleCharacters > 0 && typing) log.SawPartialTyping = true;
                if (typing) continue;

                if (++settledFrames < 2) continue;
                if (!recorded) {
                    yield return new WaitForSecondsRealtime(0.35f);
                    recorded = true;
                    log.Settled.Add(Snapshot(view, root, card, lastBody));
                    shots?.Take($"line{log.Lines.Count:00}");
                }
                root.GetComponent<Button>().onClick.Invoke();
            }
        }

        static LineSnapshot Snapshot(StoryDialogueView view, RectTransform root, RectTransform card, string text) {
            var shade = root.Find("Stage/Narrative Shade").GetComponent<Image>().color.a;
            var pos = ((RectTransform)root.Find("Stage/Portrait")).anchoredPosition;
            return new LineSnapshot {
                Text = text,
                Background = view.BackgroundSprite != null ? view.BackgroundSprite.name : null,
                BackgroundBlack = view.BackgroundIsBlack,
                Cg = view.CgSprite != null ? view.CgSprite.name : null,
                Curtain = view.CurtainAlpha,
                Eyes = view.EyesOpen,
                Flash = view.FlashAlpha,
                Shake = view.Stage.anchoredPosition,
                Narrative = shade > 0.01f,
                ShadeAlpha = shade,
                PortraitDrop = -StoryDialogueView.PortraitInset - pos.y,
                CardHeight = card.rect.height,
                Scroll = ((RectTransform)card.Find("Body/Content")).anchoredPosition.y,
            };
        }
    }
}
