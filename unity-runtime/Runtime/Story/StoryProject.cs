using System.Collections.Generic;
using Newtonsoft.Json;

namespace StoryRuntime.Story {

    // 對應 docs/story.schema.json。欄位名沿用 JSON 的原名，
    // 只有 default 因為是 C# 關鍵字才改名並用 JsonProperty 對回去。
    //
    // 刻意全部是可空的參照型別而非強制存在：舊版檔案缺欄位時應該照樣讀得進來，
    // 由 StoryPlayer 決定缺什麼算錯。讀檔階段就丟例外的話，
    // 使用者只會看到「載入失敗」而不知道是哪一句有問題。

    public sealed class StoryProject {
        [JsonProperty("meta")] public StoryMeta Meta;
        // 標籤定義跟著專案走，runtime 不內建 —— 兩邊共用同一份才不會出現
        // 「編輯器認得、遊戲不認得」的標籤。
        [JsonProperty("tagRegistry")] public List<Tags.TagDef> TagRegistry = new List<Tags.TagDef>();
        [JsonProperty("variables")] public List<StoryVariable> Variables = new List<StoryVariable>();
        [JsonProperty("characters")] public List<StoryCharacter> Characters = new List<StoryCharacter>();
        [JsonProperty("scenes")] public List<StoryScene> Scenes = new List<StoryScene>();

        public StoryScene FindScene(string sceneId) {
            foreach (StoryScene scene in Scenes) {
                if (scene.Id == sceneId) return scene;
            }
            return null;
        }
    }

    public sealed class StoryMeta {
        [JsonProperty("formatVersion")] public string FormatVersion;
        [JsonProperty("projectName")] public string ProjectName;
        [JsonProperty("languages")] public List<string> Languages = new List<string>();
        [JsonProperty("baseLanguage")] public string BaseLanguage;
        [JsonProperty("tagSyntax")] public string TagSyntax;
    }

    public sealed class StoryVariable {
        [JsonProperty("id")] public string Id;
        [JsonProperty("type")] public string Type;
        [JsonProperty("default")] public object DefaultValue;
        [JsonProperty("description")] public string Description;
    }

    public sealed class StoryCharacter {
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public Dictionary<string, string> Name = new Dictionary<string, string>();
        [JsonProperty("defaultPortrait")] public string DefaultPortrait;
    }

    public sealed class StoryScene {
        [JsonProperty("id")] public string Id;
        [JsonProperty("name")] public string Name;
        [JsonProperty("entryNodeId")] public string EntryNodeId;
        [JsonProperty("nodes")] public List<StoryNode> Nodes = new List<StoryNode>();

        Dictionary<string, StoryNode> _byId;

        // 一個場景有好幾百個節點，每次跳轉都線性搜尋會在長劇情裡累積成可見的延遲。
        public StoryNode FindNode(string nodeId) {
            if (nodeId == null) return null;
            if (_byId == null) {
                _byId = new Dictionary<string, StoryNode>(Nodes.Count);
                foreach (StoryNode node in Nodes) {
                    if (node.Id != null) _byId[node.Id] = node;
                }
            }
            return _byId.TryGetValue(nodeId, out StoryNode found) ? found : null;
        }
    }

    public sealed class StoryNode {
        [JsonProperty("id")] public string Id;
        [JsonProperty("kind")] public string Kind = "line";
        [JsonProperty("speaker")] public string Speaker;
        [JsonProperty("portrait")] public string Portrait;
        [JsonProperty("text")] public Dictionary<string, string> Text = new Dictionary<string, string>();
        [JsonProperty("choices")] public List<StoryChoice> Choices = new List<StoryChoice>();
        [JsonProperty("next")] public string Next;
        [JsonProperty("condition")] public string Condition;
        [JsonProperty("audio")] public string Audio;
        [JsonProperty("notes")] public string Notes;
        [JsonProperty("expression")] public string Expression;
        [JsonProperty("branches")] public List<StoryBranch> Branches = new List<StoryBranch>();
        [JsonProperty("extras")] public Dictionary<string, string> Extras = new Dictionary<string, string>();
    }

    public sealed class StoryChoice {
        [JsonProperty("id")] public string Id;
        [JsonProperty("text")] public Dictionary<string, string> Text = new Dictionary<string, string>();
        [JsonProperty("targetNodeId")] public string TargetNodeId;
        [JsonProperty("condition")] public string Condition;
        [JsonProperty("speaker")] public string Speaker;
    }

    public sealed class StoryBranch {
        [JsonProperty("id")] public string Id;
        [JsonProperty("condition")] public string Condition;
        [JsonProperty("targetNodeId")] public string TargetNodeId;
        [JsonProperty("speaker")] public string Speaker;
    }

    public static class StoryLoader {

        public static StoryProject FromJson(string json) =>
            JsonConvert.DeserializeObject<StoryProject>(json, Settings);

        // MissingMemberHandling 保持 Ignore：編輯器新增欄位時舊版 runtime 仍讀得進來，
        // 這是 formatVersion 只在 major 不符時才報錯的前提。
        static readonly JsonSerializerSettings Settings = new JsonSerializerSettings {
            MissingMemberHandling = MissingMemberHandling.Ignore,
            NullValueHandling = NullValueHandling.Ignore,
        };
    }
}
