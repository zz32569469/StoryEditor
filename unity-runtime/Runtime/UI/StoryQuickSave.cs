using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using StoryRuntime.Expressions;

namespace StoryRuntime.UI {

    // 快速存檔的內容：停在哪一句、劇本宣告的變數值、讀過的句子、對話紀錄。
    // 遊戲有自己的存檔系統時，把這份塞進自己的存檔就好（它可以整份轉成 JSON）
    public sealed class StoryQuickSave {

        public sealed class Value {
            [JsonProperty("type")] public string Type;
            [JsonProperty("value")] public object Raw;
        }

        [JsonProperty("sceneId")] public string SceneId;
        [JsonProperty("nodeId")] public string NodeId;
        [JsonProperty("variables")] public Dictionary<string, Value> Variables = new Dictionary<string, Value>();
        [JsonProperty("read")] public List<string> Read = new List<string>();
        [JsonProperty("backlog")] public List<StoryBacklog.Entry> Backlog = new List<StoryBacklog.Entry>();

        public static Value Encode(StoryValue value) =>
            value.IsNumber ? new Value { Type = "number", Raw = value.AsNumber }
            : value.IsBool ? new Value { Type = "bool", Raw = value.AsBool }
            : new Value { Type = "string", Raw = value.AsString };

        public static StoryValue Decode(Value value) {
            switch (value?.Type) {
                case "number": return StoryValue.Number(System.Convert.ToDouble(value.Raw, System.Globalization.CultureInfo.InvariantCulture));
                case "bool":   return StoryValue.Bool(System.Convert.ToBoolean(value.Raw));
                default:       return StoryValue.Text(value?.Raw?.ToString() ?? "");
            }
        }

        public string ToJson() => JsonConvert.SerializeObject(this, Formatting.Indented);
        public static StoryQuickSave FromJson(string json) => JsonConvert.DeserializeObject<StoryQuickSave>(json);
    }

    // 快速存檔放哪裡。預設皮膚的「快存／快讀」按鈕透過它讀寫
    public interface IStoryQuickSaveStore {
        void Save(StoryQuickSave data);
        // 沒有存過回傳 null
        StoryQuickSave Load();
    }

    public sealed class MemoryQuickSaveStore : IStoryQuickSaveStore {
        string _json;
        public void Save(StoryQuickSave data) => _json = data.ToJson();
        public StoryQuickSave Load() => _json == null ? null : StoryQuickSave.FromJson(_json);
    }

    public sealed class FileQuickSaveStore : IStoryQuickSaveStore {
        readonly string _path;
        public FileQuickSaveStore(string path) { _path = path; }
        public void Save(StoryQuickSave data) {
            Directory.CreateDirectory(Path.GetDirectoryName(_path));
            File.WriteAllText(_path, data.ToJson());
        }
        public StoryQuickSave Load() => File.Exists(_path) ? StoryQuickSave.FromJson(File.ReadAllText(_path)) : null;
    }
}
