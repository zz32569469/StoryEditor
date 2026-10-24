using UnityEngine;

namespace StoryRuntime.UI {

    // 劇本的立繪代號（例「店長-微笑」）→ Sprite。跟背景、插圖分開一張表，美術的命名規則常常不同
    [CreateAssetMenu(fileName = "StoryPortraitTable", menuName = "Story Runtime/立繪對應表")]
    public class StoryPortraitTable : StorySpriteTable { }
}
