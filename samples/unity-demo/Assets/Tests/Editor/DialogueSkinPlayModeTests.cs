using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using StoryRuntime.Story;
using StoryRuntime.UI;
using StoryRuntime.Unity;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace StoryDemo.Tests {

    // 預設皮膚（原型 UI25）在 Play Mode 的實機走訪：真的建出畫面、模擬玩家點擊／選選項／填輸入欄，並截圖。
    //
    // 進 Play Mode 會重載 domain：測試方法裡被 lambda 捕捉的變數放在編譯器產生的閉包物件裡，
    // 那個物件在 EnterPlayMode 之前就建好、重載後還原不回來（變成 null）。
    // 所以外層只負責進出 Play Mode，內容放在進場之後才建立的另一個 IEnumerator
    public class DialogueSkinPlayModeTests {

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
            var shots = new Screenshotter(ShotDir, objects, AssetDatabase.LoadAssetAtPath<Sprite>(Background));
            var log = new UiLog();
            yield return PlayModeDriver.Drive(() => done, log, new Dictionary<string, string> { ["rookieName"] = "小林" }, shots);

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
            var settled = log.Settled;
            CollectionAssert.AreEqual(new[] { true, false, true, false, false, false }, settled.Select(s => s.Narrative),
                "旁白與內心話才有情境遮罩");
            Assert.AreEqual(StoryDialogueView.ShadeColor.a, settled[0].ShadeAlpha, 0.01f, "遮罩色 #17222c20");
            Assert.AreEqual(1f, Mathf.Round(settled[2].PortraitDrop / (10 * StoryDialogueView.S)), "內心話時立繪下移 10px");
            Assert.AreEqual(0f, Mathf.Round(settled[1].PortraitDrop), "立繪的主人說話時在原位");
            Assert.AreEqual(StoryDialogueView.PadY * 2 + StoryDialogueView.TextMax, settled.Max(s => s.CardHeight), 0.5f,
                "長文把文字區撐到上限 240 為止（內距 30＋240＋30）");
            Assert.GreaterOrEqual(settled.Min(s => s.CardHeight), StoryDialogueView.MinHeight - 0.5f);
            Assert.Greater(settled.Max(s => s.Scroll), 0, "超過上限的長文要捲動，跟著逐字捲到最新一行");
            Assert.AreEqual("小林", vars.TryGet("rookieName", out var name) ? name.AsString : null);
            Assert.GreaterOrEqual(shots.Count, 7, "截圖：" + ShotDir);

            foreach (var o in objects) if (o != null) Object.Destroy(o);
            var canvas = GameObject.Find("Story Dialogue Canvas");
            if (canvas != null) Object.Destroy(canvas);
        }

        internal static IEnumerator Then(IEnumerator routine, Action after) {
            yield return routine;
            after();
        }
    }
}
