using System;
using System.Collections.Generic;

namespace StoryRuntime.Tags {

    public enum MotionKind { Shake, Wave }

    public readonly struct MotionTag {
        public readonly MotionKind Kind;
        public readonly double Amp, Freq;
        public MotionTag(MotionKind kind, double amp, double freq) { Kind = kind; Amp = amp; Freq = freq; }
    }

    // [shake]／[wave] 的逐字位移。數值照網頁預覽的 CSS（src/App.css 的 fx-shake／fx-wave），
    // 單位是網頁上的 px；畫面層自己換算成畫布單位。回傳的 Y 往上為正（Unity 的方向，跟 CSS 相反）。
    //
    // 跟網頁不完全一樣的地方：網頁的 shake 整段同一個相位，這裡每個字錯開一格，
    // 才是標籤說明寫的「逐字抖動」。
    public static class TextMotion {

        // fx-shake 的四個關鍵影格（CSS 的 y 往下為正），steps(1) 一格一格跳、不補間
        static readonly double[,] _shakeFrames = { { 0, 0 }, { 1, -0.6 }, { -0.8, 0.5 }, { 0.4, 0.9 } };
        // fx-wave 的 animation-delay：每個字提前 0.08 秒
        public const double WaveStagger = 0.08;

        // 每個字作用中的 shake／wave；沒有的字是 null。全文都沒有時回傳 null，畫面層就不必每幀改頂點
        public static MotionTag[][] Build(ParsedText parsed) {
            MotionTag[][] result = null;
            for (int i = 0; i < parsed.Chars.Count; i += 1) {
                List<MotionTag> tags = null;
                foreach (ResolvedTag effect in parsed.Chars[i].Effects) {
                    MotionKind kind;
                    if (effect.Name == "shake") kind = MotionKind.Shake;
                    else if (effect.Name == "wave") kind = MotionKind.Wave;
                    else continue;
                    (tags ?? (tags = new List<MotionTag>())).Add(new MotionTag(kind, Number(effect, "amp"), Number(effect, "freq")));
                }
                if (tags == null) continue;
                if (result == null) result = new MotionTag[parsed.Chars.Count][];
                result[i] = tags.ToArray();
            }
            return result;
        }

        // 第 index 個字在 time 秒時的位移；巢狀的效果相加
        public static (double X, double Y) Offset(MotionTag[] tags, int index, double time) {
            double x = 0, y = 0;
            if (tags == null) return (x, y);
            foreach (MotionTag tag in tags) {
                if (tag.Freq <= 0 || tag.Amp == 0) continue;
                if (tag.Kind == MotionKind.Shake) {
                    int frame = (int)(((long)Math.Floor(time * tag.Freq * 4) + index) % 4);
                    x += tag.Amp * _shakeFrames[frame, 0];
                    y -= tag.Amp * _shakeFrames[frame, 1];
                } else {
                    // ease-in-out 的 0 → -amp → 0 用半個餘弦近似
                    double phase = (time + index * WaveStagger) * tag.Freq;
                    y += tag.Amp * (1 - Math.Cos(2 * Math.PI * phase)) / 2;
                }
            }
            return (x, y);
        }

        static double Number(ResolvedTag tag, string name) =>
            tag.Params.TryGetValue(name, out TagParamValue value) && value.Kind == TagValueKind.Number ? value.AsNumber : 0;
    }
}
