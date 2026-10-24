using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
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

    // 閱讀輔助在 Play Mode 實機操作：略過讀過的句子、快速存讀檔、對話紀錄（300 筆）、隱藏對話框、文字速度。
    // 用中性範例劇本 sample-cafe 走一遍讓句子變成「讀過」，再從頭播一次測略過
    public class ReadingAidsPlayModeTests {

        public static string ShotDir => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Screenshots", "reading-aids"));
        const string Scene = "第一幕-開幕前一天";

        [UnityTest]
        public IEnumerator ReadingAids_SkipQuickSaveBacklogHideSpeed() {
            yield return new EnterPlayMode();
            yield return Walk();
            yield return new ExitPlayMode();
        }

        static IEnumerator Walk() {
            Application.runInBackground = true;
            var objects = new List<Object>();
            var host = new GameObject("Test Host");
            objects.Add(host);
            var controller = host.AddComponent<StoryDialogueController>();
            controller.UseProject(StoryLoader.FromJson(File.ReadAllText(Path.Combine(Application.dataPath, "..", "..", "sample-cafe.story.json"))));
            controller.portraits   = AssetDatabase.LoadAssetAtPath<StoryPortraitTable>("Assets/Demo/DemoPortraits.asset");
            controller.backgrounds = AssetDatabase.LoadAssetAtPath<StorySpriteTable>("Assets/Demo/DemoBackgrounds.asset");
            controller.cgs         = AssetDatabase.LoadAssetAtPath<StorySpriteTable>("Assets/Demo/DemoCgs.asset");
            controller.font        = DemoFonts.Cjk();
            controller.QuickSaves  = new MemoryQuickSaveStore();
            controller.UseAudio(new SilentAudio());
            var inputs = new Dictionary<string, string> { ["newcomerName"] = "小林" };

            // 第一遍：整場讀過
            var vars = new InMemoryStoryVariables();
            StoryPlayer.SeedDefaults(controller.Project, vars);
            bool done = false;
            controller.StartCoroutine(DialogueSkinPlayModeTests.Then(controller.Play(Scene, vars), () => done = true));
            yield return null;
            yield return PlayModeDriver.Drive(() => done, new UiLog(), inputs, null, 120f);
            Assert.IsTrue(done, "第一遍沒有播完");
            int firstPass = controller.ReadHistory.Count;
            Assert.Greater(firstPass, 15);

            // 第二遍：從頭播，按 SKIP
            done = false;
            vars = new InMemoryStoryVariables();
            StoryPlayer.SeedDefaults(controller.Project, vars);
            controller.StartCoroutine(DialogueSkinPlayModeTests.Then(controller.Play(Scene, vars), () => done = true));
            yield return null;
            var shots = new Screenshotter(ShotDir, objects);
            var view = GameObject.Find("Story Dialogue Canvas").GetComponent<StoryDialogueView>();
            var card = view.Card;
            var body = card.Find("Body/Content/Text").GetComponent<TextMeshProUGUI>();
            yield return Until(() => body.text.Length > 0, 5);

            float skipStarted = Time.realtimeSinceStartup;
            Click(card, "Skip");
            Assert.IsTrue(view.SkipOn);
            yield return null;
            shots.Take("skip-on");
            var input = card.Find("Input");
            yield return Until(() => input.gameObject.activeSelf, 10);
            float skipped = Time.realtimeSinceStartup - skipStarted;
            Assert.IsTrue(input.gameObject.activeSelf, "略過要停在輸入欄");
            Assert.IsFalse(view.SkipOn, "碰到輸入就關掉略過");
            Assert.Less(skipped, 3f, $"六句讀過的台詞要很快跳完（實際 {skipped:0.00} 秒；照常閱讀要十幾秒）");
            yield return new WaitForSecondsRealtime(0.3f);
            shots.Take("skip-stopped-at-input");
            foreach (var field in input.GetComponentsInChildren<TMP_InputField>()) field.text = "小林";
            Click(input, "Footer/確定");
            yield return Until(() => body.text.Contains("小林"), 5);

            // 快速存檔 → 往前兩句 → 快速讀檔
            yield return Until(() => body.maxVisibleCharacters >= body.textInfo.characterCount, 5);
            string savedLine = body.text;
            Click(card, "Quick Save");
            Assert.AreEqual("已快速存檔", view.Notice);
            yield return null;
            shots.Take("quick-saved");
            for (int i = 0; i < 2; i += 1) {
                yield return Advance(view, body);
            }
            Assert.AreNotEqual(savedLine, body.text);
            Click(card, "Quick Load");
            yield return null;
            Assert.AreEqual(savedLine, body.text, "回到存檔那一句");
            Assert.AreEqual("已讀取快速存檔", view.Notice);
            Assert.AreEqual("小林", vars.TryGet("newcomerName", out var name) ? name.AsString : null);

            // 對話紀錄：補到 300 筆（中性的編號句子）看捲動與效能
            int real = controller.Backlog.Entries.Count;
            Assert.Greater(real, firstPass, "兩遍的台詞、選項、輸入都記著");
            for (int i = controller.Backlog.Entries.Count; i < StoryBacklog.DefaultCapacity; i += 1) {
                controller.Backlog.Add(new StoryBacklog.Entry { Kind = StoryBacklog.Kind.Line, Speaker = "旁白", Text = $"第 {i + 1} 筆紀錄。" });
            }
            float opening = Time.realtimeSinceStartup;
            Click(card, "Log");
            float openSeconds = Time.realtimeSinceStartup - opening;
            Assert.IsTrue(view.IsBacklogOpen);
            Assert.AreEqual(StoryBacklog.DefaultCapacity, view.BacklogRows, "300 筆全部列出");
            Assert.Less(openSeconds, 1.5f, $"打開 300 筆紀錄花了 {openSeconds:0.00} 秒");
            yield return new WaitForSecondsRealtime(0.2f);
            shots.Take("backlog-newest");
            var scroll = view.Root.Find("Backlog/Panel/View").GetComponent<ScrollRect>();
            scroll.verticalNormalizedPosition = 1;
            yield return null;
            shots.Take("backlog-oldest");
            string beforeLog = body.text;
            view.Root.Find("Backlog/Panel/關閉").GetComponent<Button>().onClick.Invoke();
            Assert.IsFalse(view.IsBacklogOpen);
            Assert.AreEqual(beforeLog, body.text, "看紀錄不會讓劇情往前");

            // 隱藏對話框：點一下只叫回來，不前進
            Click(card, "Hide");
            Assert.IsTrue(view.UiHidden);
            Assert.IsFalse(card.gameObject.activeSelf);
            yield return null;
            shots.Take("hidden");
            view.Root.GetComponent<Button>().onClick.Invoke();
            Assert.IsFalse(view.UiHidden);
            Assert.AreEqual(beforeLog, body.text, "叫回對話框的那一下不前進");

            // 文字速度：普通 → 快，下一句的逐字時間減半
            Assert.AreEqual("速度 普通", view.SpeedLabel);
            Click(card, "Speed");
            Assert.AreEqual("速度 快", view.SpeedLabel);
            yield return Advance(view, body);
            float typingStarted = Time.realtimeSinceStartup;
            yield return Until(() => body.maxVisibleCharacters >= body.textInfo.characterCount, 5);
            float fastTyping = Time.realtimeSinceStartup - typingStarted;
            float normalTyping = body.textInfo.characterCount * (float)StoryPresenter.CharSeconds;
            Assert.Less(fastTyping, normalTyping * 0.8f, $"快速 {fastTyping:0.00} 秒，普通約 {normalTyping:0.00} 秒");
            shots.Take("speed-fast");

            controller.Stop();
            yield return null;
            Assert.AreEqual(2f, controller.textSpeed, 1e-3f, "換過的速度寫回控制器，下一場沿用");
            Assert.IsTrue(shots.Count >= 7);
            foreach (var o in objects) if (o != null) Object.Destroy(o);
            var canvas = GameObject.Find("Story Dialogue Canvas");
            if (canvas != null) Object.Destroy(canvas);
        }

        static void Click(Transform parent, string name) {
            var target = parent.Find(name);
            Assert.IsNotNull(target, $"找不到按鈕「{name}」");
            target.GetComponent<Button>().onClick.Invoke();
        }

        // 等整句出現再點下一句
        static IEnumerator Advance(StoryDialogueView view, TextMeshProUGUI body) {
            string before = body.text;
            yield return Until(() => body.maxVisibleCharacters >= body.textInfo.characterCount, 5);
            view.Root.GetComponent<Button>().onClick.Invoke();
            yield return Until(() => body.text != before, 5);
        }

        static IEnumerator Until(Func<bool> condition, float timeout) {
            float started = Time.realtimeSinceStartup;
            while (!condition() && Time.realtimeSinceStartup - started < timeout) yield return null;
        }

        sealed class SilentAudio : IStoryAudio {
            public void PlaySfx(string key) { }
            public void PlayBgm(string key, float fade) { }
            public void StopBgm(float fade) { }
        }
    }
}
