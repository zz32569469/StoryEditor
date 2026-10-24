using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using StoryRuntime.Story;
using StoryRuntime.UI;
using StoryRuntime.Unity;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using Object = UnityEngine.Object;

namespace StoryDemo.Tests {

    // 預設皮膚（原型 UI25）在 Play Mode 的實機走訪：真的建出畫面、模擬玩家點擊／選選項／填輸入欄，並截圖。
    //
    // 進 Play Mode 會重載 domain：測試方法裡被 lambda 捕捉的變數放在編譯器產生的閉包物件裡，
    // 那個物件在 EnterPlayMode 之前就建好、重載後還原不回來（變成 null）。
    // 所以外層只負責進出 Play Mode，內容放在進場之後才建立的另一個 IEnumerator
    public class DialogueSkinPlayModeTests {

        const float Timeout = 60f;
        const string Story = "Assets/Demo/Stories/ui-walk.story.json";
        const string Table = "Assets/Demo/DemoPortraits.asset";
        const string Background = "Assets/Demo/Art/Backgrounds/店內-白天.png";

        public static string ShotDir => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Screenshots", "ui25"));

        [UnityTest]
        public IEnumerator Skin_WalksSceneToEnd() {
            yield return new EnterPlayMode();
            yield return WalkScene();
            yield return new ExitPlayMode();
        }

        static IEnumerator WalkScene() {
            Application.runInBackground = true;
            var objects = new List<Object>();
            var host = new GameObject("Test Host");
            objects.Add(host);
            var controller = host.AddComponent<StoryDialogueController>();
            controller.UseProject(StoryLoader.FromJson(AssetDatabase.LoadAssetAtPath<TextAsset>(Story).text));
            controller.portraits = AssetDatabase.LoadAssetAtPath<StoryPortraitTable>(Table);
            controller.font = DemoFonts.Cjk();
            Assert.IsNotNull(controller.portraits, "先跑 DemoSetup.Run 建立立繪表");
            Assert.IsNotNull(controller.font, "需要系統中文字型");

            int opened = 0, closed = 0;
            controller.Opened += () => opened++;
            controller.Closed += () => closed++;

            var vars = new InMemoryStoryVariables();
            StoryPlayer.SeedDefaults(controller.Project, vars);
            bool done = false;
            controller.StartCoroutine(Then(controller.Play("開幕前一天", vars), () => done = true));

            yield return null;
            var shots = new Screenshotter(objects);
            var log = new UiLog();
            yield return Drive(() => done, log, new Dictionary<string, string> { ["rookieName"] = "小林" }, shots);

            Assert.IsTrue(done, "劇情沒有在時限內播完");
            Assert.IsNull(controller.LastError);
            Assert.AreEqual(1, opened); Assert.AreEqual(1, closed);
            Assert.AreEqual(6, log.Lines.Count, string.Join("\n", log.Lines));
            Assert.AreEqual("咖啡店開幕的前一天，早上七點。", log.Lines[0]);
            Assert.AreEqual("小林，明天就拜託你了。", log.Lines[5]);
            CollectionAssert.AreEqual(new[] { "旁白", "店長", "新人", "新人", "店長", "店長" }, log.Speakers,
                "旁白寫「旁白」；「新人 os」的名牌寫本人");
            CollectionAssert.AreEqual(new[] { 1 }, log.ChoiceCounts, "解鎖條件不成立的選項不顯示");
            Assert.IsTrue(log.SawPartialTyping, "逐字顯示要真的一個字一個字出現");
            CollectionAssert.AreEqual(new[] { true, false, true, false, false, false }, log.Narrative, "旁白與內心話才有情境遮罩");
            Assert.AreEqual(StoryDialogueView.ShadeColor.a, log.ShadeAlpha, 0.01f, "遮罩色 #17222c20");
            Assert.AreEqual(1f, Mathf.Round(log.PortraitDrop[2] / (10 * StoryDialogueView.S)), "內心話時立繪下移 10px");
            Assert.AreEqual(0f, Mathf.Round(log.PortraitDrop[1]), "立繪的主人說話時在原位");
            Assert.AreEqual(StoryDialogueView.PadY * 2 + StoryDialogueView.TextMax, log.CardHeights.Max(), 0.5f,
                "長文把文字區撐到上限 240 為止（內距 30＋240＋30）");
            Assert.GreaterOrEqual(log.CardHeights.Min(), StoryDialogueView.MinHeight - 0.5f);
            Assert.Greater(log.MaxScroll, 0, "超過上限的長文要捲動，跟著逐字捲到最新一行");
            Assert.AreEqual("小林", vars.TryGet("rookieName", out var name) ? name.AsString : null);
            Assert.GreaterOrEqual(shots.Count, 7, "截圖：" + ShotDir);

            foreach (var o in objects) if (o != null) Object.Destroy(o);
            var canvas = GameObject.Find("Story Dialogue Canvas");
            if (canvas != null) Object.Destroy(canvas);
        }

        static IEnumerator Then(IEnumerator routine, Action after) {
            yield return routine;
            after();
        }

        // ── 截圖 ─────────────────────────────────────────────

        // batch mode 沒有 Game 視窗可截，改把畫布切到 Screen Space - Camera，用相機畫進 1280×960 的 RenderTexture
        sealed class Screenshotter {
            readonly Camera _camera;
            readonly RenderTexture _target;
            public int Count;

            public Screenshotter(List<Object> objects) {
                Directory.CreateDirectory(ShotDir);
                foreach (var old in Directory.GetFiles(ShotDir, "*.png")) File.Delete(old);

                _target = new RenderTexture(1280, 960, 24);
                _camera = new GameObject("Screenshot Camera").AddComponent<Camera>();
                _camera.clearFlags = CameraClearFlags.SolidColor;
                _camera.backgroundColor = Color.gray;
                _camera.targetTexture = _target;
                objects.Add(_camera.gameObject); objects.Add(_target);

                var bg = DemoBootstrap.CreateBackground(AssetDatabase.LoadAssetAtPath<Sprite>(Background));
                bg.renderMode = RenderMode.ScreenSpaceCamera;
                bg.worldCamera = _camera;
                bg.planeDistance = 50;
                objects.Add(bg.gameObject);

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
                File.WriteAllBytes(Path.Combine(ShotDir, $"{++Count:00}-{name}.png"), tex.EncodeToPNG());
                Object.Destroy(tex);
            }
        }

        // ── 模擬玩家 ─────────────────────────────────────────

        sealed class UiLog {
            public readonly List<string> Lines = new List<string>();
            public readonly List<string> Speakers = new List<string>();
            public readonly List<int> ChoiceCounts = new List<int>();
            public readonly List<bool> Narrative = new List<bool>();
            public readonly List<float> PortraitDrop = new List<float>();
            public readonly List<float> CardHeights = new List<float>();
            public bool SawPartialTyping;
            public float ShadeAlpha, MaxScroll;
        }

        // 每一幀看畫面上有什麼就做什麼：輸入欄就填、選項就點第一個、
        // 台詞就等它整句出現、動畫穩定後記錄（並截圖），再點下一句
        static IEnumerator Drive(Func<bool> finished, UiLog log, Dictionary<string, string> inputs, Screenshotter shots) {
            float started = Time.realtimeSinceStartup;
            string lastBody = null;
            int settledFrames = 0;
            bool recorded = false;

            while (!finished() && Time.realtimeSinceStartup - started < Timeout) {
                yield return null;
                var canvas = GameObject.Find("Story Dialogue Canvas");
                if (canvas == null) continue;
                var root = canvas.transform.Find("Story Dialogue");
                if (!root.gameObject.activeSelf) continue;
                var card = (RectTransform)root.Find("Card");

                var input = card.Find("Input");
                if (input.gameObject.activeSelf) {
                    yield return new WaitForSecondsRealtime(0.3f);
                    shots.Take("input");
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
                    shots.Take("choices");
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
                }
                bool typing = body.maxVisibleCharacters < body.textInfo.characterCount;
                if (body.maxVisibleCharacters > 0 && typing) log.SawPartialTyping = true;
                if (typing) continue;

                // 整句出現後等立繪位移與遮罩淡入跑完（各約 0.2 秒）再記錄
                if (++settledFrames < 2) continue;
                if (!recorded) {
                    yield return new WaitForSecondsRealtime(0.35f);
                    recorded = true;
                    var shade = root.Find("Narrative Shade").GetComponent<Image>().color.a;
                    log.Narrative.Add(shade > 0.01f);
                    if (shade > 0.01f) log.ShadeAlpha = shade;
                    var pos = ((RectTransform)root.Find("Portrait")).anchoredPosition;
                    log.PortraitDrop.Add(-StoryDialogueView.PortraitInset - pos.y);
                    log.CardHeights.Add(card.rect.height);
                    log.MaxScroll = Mathf.Max(log.MaxScroll, ((RectTransform)card.Find("Body/Content")).anchoredPosition.y);
                    shots.Take($"line{log.Lines.Count}");
                }
                root.GetComponent<Button>().onClick.Invoke();
            }
        }
    }
}
