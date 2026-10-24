using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryRuntime.UI {

    // 劇本的立繪代號 → Sprite。
    // 代號是劇本表「立繪」欄的原字串（常用中文，例「居家服-通常」），runtime 只傳代號、不碰資產，
    // 換一套美術命名只要改這張表，不必動劇本也不必動 runtime
    [CreateAssetMenu(fileName = "StoryPortraitTable", menuName = "Story Runtime/立繪對應表")]
    public class StoryPortraitTable : ScriptableObject {

        [Serializable]
        public struct Entry {
            [Tooltip("劇本裡寫的立繪代號")] public string key;
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
