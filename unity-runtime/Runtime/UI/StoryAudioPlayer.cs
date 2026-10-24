using UnityEngine;

namespace StoryRuntime.UI {

    // IStoryAudio 的預設實作：效果音一軌、BGM 兩軌輪流（交叉淡化時新舊同時在播）
    public class StoryAudioPlayer : MonoBehaviour, IStoryAudio {

        public StoryAudioTable table;
        [Range(0, 1)] public float bgmVolume = 0.8f;
        [Range(0, 1)] public float sfxVolume = 1f;

        AudioSource _sfx;
        readonly AudioSource[] _bgm = new AudioSource[2];
        int _current;
        float _fade, _fadeElapsed;

        public string CurrentBgm { get; private set; }
        public string LastSfx { get; private set; }

        void Awake() {
            _sfx = gameObject.AddComponent<AudioSource>();
            _sfx.playOnAwake = false;
            for (int i = 0; i < 2; i += 1) {
                _bgm[i] = gameObject.AddComponent<AudioSource>();
                _bgm[i].playOnAwake = false;
                _bgm[i].loop = true;
                _bgm[i].volume = 0;
            }
        }

        public void PlaySfx(string key) {
            LastSfx = key;
            if (!Find(key, out AudioClip clip)) return;
            _sfx.PlayOneShot(clip, sfxVolume);
        }

        public void PlayBgm(string key, float fade) {
            if (key == CurrentBgm) return;   // 同一首不重頭播
            if (!Find(key, out AudioClip clip)) return;
            CurrentBgm = key;
            _current = 1 - _current;
            var next = _bgm[_current];
            next.clip = clip;
            next.volume = 0;
            next.Play();
            StartFade(fade);
        }

        public void StopBgm(float fade) {
            CurrentBgm = null;
            _current = 1 - _current;
            _bgm[_current].Stop();
            _bgm[_current].clip = null;
            StartFade(fade);
        }

        bool Find(string key, out AudioClip clip) {
            clip = null;
            if (table != null && table.TryGet(key, out clip)) return true;
            Debug.LogWarning($"[StoryAudioPlayer] 音效對應表裡沒有「{key}」，略過");
            return false;
        }

        void StartFade(float seconds) {
            _fade = Mathf.Max(0.0001f, seconds);
            _fadeElapsed = 0;
        }

        void Update() {
            if (_fadeElapsed >= _fade) return;
            _fadeElapsed += Time.unscaledDeltaTime;
            float t = Mathf.Clamp01(_fadeElapsed / _fade);
            var on = _bgm[_current];
            var off = _bgm[1 - _current];
            if (on.clip != null) on.volume = bgmVolume * t;
            off.volume = bgmVolume * (1 - t);
            if (t >= 1 && off.isPlaying) off.Stop();
        }
    }
}
