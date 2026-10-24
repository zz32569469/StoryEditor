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

    // 中性範例劇本 samples/sample-cafe.story.json（咖啡店開幕前一天）在 Play Mode 走完一遍：
    // 背景切換與溶接、插圖顯示與收起、每一種畫面效果、效果音與 BGM、屬性變化、物品消耗、功能解鎖，並截圖。
    public class SampleCafePlayModeTests {

        public static string ShotDir => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Screenshots", "sample-cafe"));

        sealed class RecordingAudio : IStoryAudio {
            public readonly List<string> Log = new List<string>();
            readonly IStoryAudio _inner;
            public RecordingAudio(IStoryAudio inner) { _inner = inner; }
            public void PlaySfx(string key) { Log.Add($"sfx:{key}"); _inner.PlaySfx(key); }
            public void PlayBgm(string key, float fade) { Log.Add($"bgm:{key}"); _inner.PlayBgm(key, fade); }
            public void StopBgm(float fade) { Log.Add("stop"); _inner.StopBgm(fade); }
        }

        [UnityTest]
        public IEnumerator SampleCafe_PlaysEveryStageDirective() {
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
            string json = File.ReadAllText(Path.Combine(Application.dataPath, "..", "..", "sample-cafe.story.json"));
            controller.UseProject(StoryLoader.FromJson(json));
            controller.portraits   = AssetDatabase.LoadAssetAtPath<StoryPortraitTable>("Assets/Demo/DemoPortraits.asset");
            controller.backgrounds = AssetDatabase.LoadAssetAtPath<StorySpriteTable>("Assets/Demo/DemoBackgrounds.asset");
            controller.cgs         = AssetDatabase.LoadAssetAtPath<StorySpriteTable>("Assets/Demo/DemoCgs.asset");
            controller.font        = DemoFonts.Cjk();
            var player = host.AddComponent<StoryAudioPlayer>();
            player.table = AssetDatabase.LoadAssetAtPath<StoryAudioTable>("Assets/Demo/DemoAudio.asset");
            var audio = new RecordingAudio(player);
            controller.UseAudio(audio);

            var effects = new List<AttributeEffect>();
            var items = new List<string>();
            var unlocks = new List<string>();
            var hints = new List<string>();
            controller.AttributesChanged += list => effects.AddRange(list);
            controller.ItemsConsumed += (list, target) => items.AddRange(list.Select(i => $"{i.Key}×{i.Count}@{target}"));
            controller.FeaturesUnlocked += unlocks.AddRange;
            controller.InputHinted += hints.Add;

            var vars = new InMemoryStoryVariables();
            StoryPlayer.SeedDefaults(controller.Project, vars);
            bool done = false;
            controller.StartCoroutine(DialogueSkinPlayModeTests.Then(controller.Play("第一幕-開幕前一天", vars), () => done = true));

            yield return null;
            var shots = new Screenshotter(ShotDir, objects);
            var log = new UiLog();
            // 有轉場或效果的句子多截一張「剛出現」的畫面
            var effectLines = new HashSet<int> { 0, 1, 2, 4, 7, 8, 9, 10, 12, 13, 14, 15, 16 };
            yield return PlayModeDriver.Drive(() => done, log, new Dictionary<string, string> { ["newcomerName"] = "小林" },
                                              shots, 120f, i => effectLines.Contains(i));

            Assert.IsTrue(done, "劇情沒有在時限內播完");
            Assert.IsNull(controller.LastError);
            Assert.AreEqual(17, log.Lines.Count, string.Join("\n", log.Lines));
            CollectionAssert.AreEqual(new[] { 2 }, log.ChoiceCounts, "「我想調整菜單」要信任 3，還沒解鎖");
            CollectionAssert.AreEqual(new[] { "新人的名字" }, log.InputLabels, "輸入欄標題用屬性清單的名稱，不是變數名稱");

            LineSnapshot Early(string start) => log.Early[log.Lines.FindIndex(l => l.StartsWith(start))];
            LineSnapshot Settled(string start) => log.Settled[log.Lines.FindIndex(l => l.StartsWith(start))];

            // 背景：清晨店門口 → 溶接進店內 → 傍晚店門口
            Assert.AreEqual("店門口-清晨", Settled("開幕前一天").Background);
            Assert.AreEqual("店內-白天", Settled("先進來吧").Background);
            Assert.AreEqual("店門口-傍晚", Settled("傍晚").Background);
            // 睜眼：剛出現時眼睛還半張
            var opening = Early("開幕前一天");
            Assert.That(opening.Eyes, Is.InRange(0.01f, 0.99f), "睜眼效果進行中");
            // 插圖：出現、下一句收起
            Assert.AreEqual("cg-試做第一杯", Settled("兩人走到吧台前").Cg);
            Assert.IsNull(Settled("味道不錯").Cg, "插圖欄寫「無」收起");
            Assert.Greater(Early("兩人走到吧台前").Flash, 0, "閃白");
            Assert.AreNotEqual(Vector2.zero, Early("好燙").Shake, "震動");
            // 黑幕類
            Assert.AreEqual(1, Settled("第一天的準備完成了").Curtain, 0.01f, "黑幕立刻全黑");
            Assert.That(Early("傍晚").Curtain, Is.InRange(0.01f, 0.99f), "淡入進行中");
            Assert.That(Early("（明天會是").Eyes, Is.LessThan(0.99f), "閉眼進行中");

            // 逐字動畫：「[wave]味道不錯[/wave]，就是[shake]奶泡[/shake]太厚了。」
            var early = Early("味道不錯");
            var settled = Settled("味道不錯");
            for (int i = 0; i < 4; i += 1) {
                Assert.AreNotEqual(early.Motion[i].y, settled.Motion[i].y, $"wave 第 {i} 個字隨時間上下");
                Assert.AreEqual(0, settled.Motion[i].x, 1e-3f, "wave 只動上下");
            }
            Assert.AreNotEqual(settled.Motion[0].y, settled.Motion[1].y, "wave 每個字錯開");
            Assert.Greater(Mathf.Max(settled.Motion[7].magnitude, settled.Motion[8].magnitude), 0, "shake 有位移");
            foreach (int i in new[] { 4, 5, 6, 9, 10, 11 }) Assert.AreEqual(Vector2.zero, settled.Motion[i], $"第 {i} 個字沒有效果");
            for (int i = 0; i < settled.Motion.Count; i += 1)
                Assert.AreEqual(0, (settled.VertexShift[i] - settled.Motion[i]).magnitude, 0.01f, $"第 {i} 個字的頂點真的移了那麼多");

            // 立繪：左中右站位、進退場、同時多人
            float slot = StoryDialogueView.SlotOffset;
            var manager = Settled("早安").Actor("店長").Value;
            Assert.AreEqual("左", manager.Slot);
            Assert.AreEqual(-slot, manager.X, 0.5f);
            Assert.Less(Early("早安").Actor("店長").Value.Alpha, 0.99f, "淡入進行中");
            var sliding = Early("是、是的").Actor("新人").Value;
            Assert.Greater(sliding.X, slot + 1, "右滑入：從右邊外側滑進來");
            Assert.AreEqual(2, Settled("是、是的").Cast, "店長與新人同時在場");
            Assert.AreEqual(slot, Settled("是、是的").Actor("新人").Value.X, 0.5f);
            Assert.AreEqual(0, Settled("好燙").Actor("新人").Value.X, 0.5f, "位置「中」：新人移到中間");
            var three = Settled("請問");
            Assert.AreEqual(3, three.Cast, "三人同時在場");
            Assert.AreEqual("右", three.Actor("熟客").Value.Slot);
            Assert.AreEqual(0, three.Actor("熟客").Value.Drop, 0.5f, "說話的人在原位");
            Assert.Greater(three.Actor("店長").Value.Drop, 1, "其他人往下移");
            Assert.AreEqual(0, Settled("抱歉").Actor("店長").Value.Drop, 0.5f);
            Assert.IsNull(Settled("好，明天見").Actor("熟客"), "右滑出之後離場");
            Assert.IsNull(Settled("（開幕之後").Actor("店長"), "「店長：左滑出」指定別人退場");
            Assert.AreEqual(1, Settled("（開幕之後").Cast);
            Assert.AreEqual(0, Settled("傍晚").Portraits.Count, "「新人：無」立刻離場");

            // 名牌：旁白、店長、新人、內心話寫本人、系統
            Assert.AreEqual("旁白", log.Speakers[0]);
            Assert.AreEqual("新人", log.Speakers[log.Lines.FindIndex(l => l.StartsWith("（第一天上班"))]);
            Assert.AreEqual("新人", log.Speakers[log.Lines.FindIndex(l => l.StartsWith("（開幕之後"))]);
            Assert.AreEqual("系統", log.Speakers[log.Lines.FindIndex(l => l.StartsWith("第一天的準備"))]);

            // 聲音
            CollectionAssert.IsSubsetOf(new[] { "bgm:早晨的店", "sfx:鐵捲門", "sfx:咖啡機", "sfx:杯子", "sfx:門鈴", "stop" }, audio.Log);
            Assert.Less(audio.Log.IndexOf("bgm:早晨的店"), audio.Log.IndexOf("stop"));

            // 屬性變化與交給遊戲的事件
            Assert.AreEqual(1, Number(vars, "trust"));
            Assert.AreEqual(2, Number(vars, "motivation"), "進場 +1、選「再做一杯」+1");
            Assert.AreEqual(3, Number(vars, "skillExp"));
            Assert.IsTrue(effects.All(e => e.Variable != null), "範例劇本的屬性都在屬性清單裡");
            CollectionAssert.AreEqual(new[] { "咖啡豆×2@新人", "紙杯×3@新人" }, items);
            CollectionAssert.AreEqual(new[] { "營業準備" }, unlocks);
            CollectionAssert.AreEqual(new[] { "Name" }, hints, "舊寫法 OpenNameInput 照收，交給遊戲");

            foreach (var o in objects) if (o != null) Object.Destroy(o);
            var canvas = GameObject.Find("Story Dialogue Canvas");
            if (canvas != null) Object.Destroy(canvas);
        }

        static double Number(InMemoryStoryVariables vars, string id) =>
            vars.TryGet(id, out var v) ? v.AsNumber : double.NaN;
    }
}
