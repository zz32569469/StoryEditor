using System.Collections.Generic;

namespace StoryRuntime.Tags {

    public sealed class TypewriterSchedule {
        // Times[i] 是第 i 個字出現的時刻（秒，從這句話開始算）。
        public List<double> Times = new List<double>();
        public double Total;

        // 到 elapsed 這個時刻為止，應該顯示到第幾個字（可直接餵給 TMP 的
        // maxVisibleCharacters）。
        public int VisibleAt(double elapsed) {
            // 由後往前找比線性掃描省事：播放時 elapsed 單調遞增，
            // 但拖曳進度條時會任意跳，兩種情況都要正確。
            int low = 0;
            int high = Times.Count;
            while (low < high) {
                int mid = (low + high) / 2;
                if (Times[mid] <= elapsed) low = mid + 1;
                else high = mid;
            }
            return low;
        }
    }

    // 事先算出每個字出現的時間點，而不是「每幀推進一格」——
    // wait 與 speed 會讓步進速率不固定，排好表之後播放邏輯就只剩
    // 「現在該顯示到第幾個字」，也讓拖曳進度成為可能。
    //
    // 逐條對應 src/preview/RichText.tsx 的 buildSchedule：預覽與實機的節奏
    // 若不一樣，編劇在網頁上調好的停頓到遊戲裡就白調了。
    public static class Typewriter {

        public const double DefaultCharsPerSecond = 28;

        // 句末標點：這些字之後停 sentencePause 而不是一般的一字間隔（與 src/preview/schedule.ts 的 SENTENCE_END 同一組）。
        public const string SentenceEnd = "。！？!?…";

        // speed 再小也不能讓一個字花掉整場戲；與網頁端同樣夾在 0.05。
        const double MinSpeed = 0.05;

        // sentencePause：句末標點之後的停頓（秒），取代那一格的一般間隔；0 代表不特別停。
        // 遊戲的閱讀規則（原型 UI25：每字 35ms、句末停 150ms）由遊戲傳入，預設 0 讓既有節奏不變。
        public static TypewriterSchedule Build(
            ParsedText parsed, double charsPerSecond = DefaultCharsPerSecond, double sentencePause = 0) {

            var schedule = new TypewriterSchedule();
            double t = 0;
            string previous = null;

            foreach (ParsedChar entry in parsed.Chars) {
                foreach (ResolvedTag tag in entry.Before) {
                    if (tag.Name == "wait") t += Number(tag, "value", 0.3);
                }

                // speed 是成對標籤，作用範圍即這個字身上的 effects；巢狀時以最內層為準。
                double speed = 1;
                for (int i = entry.Effects.Count - 1; i >= 0; i -= 1) {
                    if (entry.Effects[i].Name != "speed") continue;
                    speed = Number(entry.Effects[i], "value", 1);
                    if (speed < MinSpeed) speed = MinSpeed;
                    break;
                }

                bool afterSentence = sentencePause > 0 && previous != null && previous.Length > 0
                    && SentenceEnd.IndexOf(previous, System.StringComparison.Ordinal) >= 0;
                t += afterSentence ? sentencePause : 1 / (charsPerSecond * speed);
                schedule.Times.Add(t);
                previous = entry.Char;
            }

            schedule.Total = t;
            return schedule;
        }

        static double Number(ResolvedTag tag, string key, double fallback) =>
            tag.Params.TryGetValue(key, out TagParamValue value) && value.Kind == TagValueKind.Number
                ? value.AsNumber
                : fallback;
    }
}
