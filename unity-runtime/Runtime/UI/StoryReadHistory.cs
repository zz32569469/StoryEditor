using System.Collections.Generic;

namespace StoryRuntime.UI {

    // 讀過的台詞（場景 id＋節點 id）。「略過」只快轉這裡面有的句子，碰到沒讀過的就停。
    // 要跟存檔一起保存：存 Keys、讀檔時 Load 回來
    public sealed class StoryReadHistory {

        readonly HashSet<string> _read = new HashSet<string>();

        static string Key(string sceneId, string nodeId) => sceneId + "\n" + nodeId;

        public bool IsRead(string sceneId, string nodeId) => _read.Contains(Key(sceneId, nodeId));
        public void MarkRead(string sceneId, string nodeId) => _read.Add(Key(sceneId, nodeId));
        public int Count => _read.Count;

        public List<string> Keys => new List<string>(_read);

        public void Load(IEnumerable<string> keys) {
            _read.Clear();
            if (keys != null) foreach (string key in keys) _read.Add(key);
        }
    }
}
