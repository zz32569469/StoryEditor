using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryRuntime.UI {

    // 劇本代號 → Sprite。背景、插圖用這個；立繪用子類別 StoryPortraitTable。
    // 代號是劇本表的原字串（常用中文），runtime 只傳代號、不碰資產：換一套美術命名只要改表
    [CreateAssetMenu(fileName = "StorySpriteTable", menuName = "Story Runtime/圖片對應表（背景、插圖）")]
    public class StorySpriteTable : ScriptableObject {

        [Serializable]
        public struct Entry {
            [Tooltip("劇本裡寫的代號")] public string key;
            public Sprite sprite;
        }

        public List<Entry> entries = new List<Entry>();

        Dictionary<string, Sprite> _byKey;

        public bool TryGet(string key, out Sprite sprite) {
            if (_byKey == null) {
                _byKey = new Dictionary<string, Sprite>(StringComparer.Ordinal);
                foreach (var e in entries) {
                    if (!string.IsNullOrEmpty(e.key)) _byKey[e.key.Trim()] = e.sprite;
                }
            }
            return _byKey.TryGetValue(key ?? "", out sprite) && sprite != null;
        }

        // 程式改了 entries 之後要呼叫，否則查的是舊表
        public void Invalidate() => _byKey = null;

        void OnValidate() => _byKey = null;
    }
}
