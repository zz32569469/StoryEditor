using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace StoryRuntime.UI {

    // 對話紀錄：看過的台詞、選過的選項、填過的輸入。超過上限丟掉最舊的
    public sealed class StoryBacklog {

        public enum Kind { Line, Choice, Input }

        public sealed class Entry {
            [JsonProperty("kind")] public Kind Kind;
            // 名牌（顯示名）；選項與輸入是空字串
            [JsonProperty("speaker")] public string Speaker;
            // TMP rich text（已插值、已轉好標記）
            [JsonProperty("text")] public string Text;
            [JsonProperty("sceneId")] public string SceneId;
            [JsonProperty("nodeId")] public string NodeId;
        }

        public const int DefaultCapacity = 300;

        readonly List<Entry> _entries = new List<Entry>();
        int _capacity = DefaultCapacity;

        public int Capacity {
            get => _capacity;
            set { _capacity = Math.Max(1, value); Trim(); }
        }

        public IReadOnlyList<Entry> Entries => _entries;

        public void Add(Entry entry) {
            _entries.Add(entry);
            Trim();
        }

        public void Clear() => _entries.Clear();

        public void Load(IEnumerable<Entry> entries) {
            _entries.Clear();
            if (entries != null) _entries.AddRange(entries);
            Trim();
        }

        void Trim() {
            if (_entries.Count > _capacity) _entries.RemoveRange(0, _entries.Count - _capacity);
        }
    }
}
