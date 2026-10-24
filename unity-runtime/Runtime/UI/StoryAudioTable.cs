using System;
using System.Collections.Generic;
using UnityEngine;

namespace StoryRuntime.UI {

    // 劇本的效果音與 OST 代號 → AudioClip
    [CreateAssetMenu(fileName = "StoryAudioTable", menuName = "Story Runtime/音效對應表")]
    public class StoryAudioTable : ScriptableObject {

        [Serializable]
        public struct Entry {
            [Tooltip("劇本「效果音」「OST」欄或 [sfx=代號] 寫的代號")] public string key;
            public AudioClip clip;
        }

        public List<Entry> entries = new List<Entry>();

        Dictionary<string, AudioClip> _byKey;

        public bool TryGet(string key, out AudioClip clip) {
            if (_byKey == null) {
                _byKey = new Dictionary<string, AudioClip>(StringComparer.Ordinal);
                foreach (var e in entries) {
                    if (!string.IsNullOrEmpty(e.key)) _byKey[e.key.Trim()] = e.clip;
                }
            }
            return _byKey.TryGetValue(key ?? "", out clip) && clip != null;
        }

        public void Invalidate() => _byKey = null;

        void OnValidate() => _byKey = null;
    }
}
