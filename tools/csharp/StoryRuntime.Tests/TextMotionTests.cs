using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StoryRuntime.Tags;
using Xunit;

namespace StoryRuntime.Tests {

    // [shake]／[wave] 的逐字位移。網頁端是 CSS 動畫，沒有程式可以產黃金測資；期望值照 src/App.css 的關鍵影格手寫
    public class TextMotionTests {

        static readonly List<TagDef> Registry =
            JsonConvert.DeserializeObject<List<TagDef>>(((JObject)GoldenData.Load("tags.json"))["registry"].ToString());

        static MotionTag[][] Build(string source) => TextMotion.Build(TagParser.ParseText(source, Registry));

        [Fact]
        public void NoMotionTagsMeansNull() => Assert.Null(Build("[b]粗[/b][color=#fff]白[/color]"));

        [Fact]
        public void OnlyTaggedCharsMoveAndDefaultsComeFromRegistry() {
            var motion = Build("前[shake]抖[/shake]後[wave]浪[/wave]");
            Assert.Equal(4, motion.Length);
            Assert.Null(motion[0]);
            Assert.Null(motion[2]);
            Assert.Equal(new MotionTag(MotionKind.Shake, 2, 20), motion[1][0]);
            Assert.Equal(new MotionTag(MotionKind.Wave, 3, 2), motion[3][0]);
        }

        [Fact]
        public void ShakeStepsThroughCssKeyframesAndEachCharIsOneFrameApart() {
            var tags = new[] { new MotionTag(MotionKind.Shake, 2, 20) };
            // 一個週期 0.05 秒、四格各 0.0125 秒
            Assert.Equal((0.0, 0.0), TextMotion.Offset(tags, 0, 0.001));
            Assert.Equal((2.0, 1.2), TextMotion.Offset(tags, 0, 0.013));    // CSS (1, -0.6)，y 翻成往上
            Assert.Equal((-1.6, -1.0), TextMotion.Offset(tags, 0, 0.026));
            Assert.Equal((2.0, 1.2), TextMotion.Offset(tags, 1, 0.001));   // 下一個字錯開一格
        }

        [Fact]
        public void WaveRisesToAmpAtHalfPeriodAndIsStaggered() {
            var tags = new[] { new MotionTag(MotionKind.Wave, 3, 2) };
            Assert.Equal(0, TextMotion.Offset(tags, 0, 0).Y, 6);
            Assert.Equal(3, TextMotion.Offset(tags, 0, 0.25).Y, 6);         // 週期 0.5 秒，一半時最高
            Assert.Equal(0, TextMotion.Offset(tags, 0, 0.25).X, 6);
            Assert.Equal(TextMotion.Offset(tags, 0, 0.08).Y, TextMotion.Offset(tags, 1, 0).Y, 6);
        }

        [Fact]
        public void NestedEffectsAddUp() {
            var motion = Build("[wave][shake]晃[/shake][/wave]");
            var (x, y) = TextMotion.Offset(motion[0], 0, 0.26);
            var shake = TextMotion.Offset(new[] { motion[0][1] }, 0, 0.26);
            var wave = TextMotion.Offset(new[] { motion[0][0] }, 0, 0.26);
            Assert.Equal(shake.X + wave.X, x, 6);
            Assert.Equal(shake.Y + wave.Y, y, 6);
        }

        [Fact]
        public void ZeroFrequencyOrAmplitudeStaysStill() {
            Assert.Equal((0.0, 0.0), TextMotion.Offset(Build("[shake freq=0]停[/shake]")[0], 0, 0.3));
            Assert.Equal((0.0, 0.0), TextMotion.Offset(Build("[wave amp=0]停[/wave]")[0], 0, 0.3));
        }
    }
}
