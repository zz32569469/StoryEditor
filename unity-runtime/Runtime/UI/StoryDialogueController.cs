using System;
using System.Collections;
using StoryRuntime.Story;
using StoryRuntime.Unity;
using TMPro;
using UnityEngine;

namespace StoryRuntime.UI {

    // 播放入口：放在場景裡指定劇本與立繪表，或用程式 AddComponent 後呼叫 UseProject。
    // 呼叫端用 coroutine 等它播完：yield return controller.Play("第一章");
    public class StoryDialogueController : MonoBehaviour {

        [Tooltip("StoryEditor 匯出的 .story.json")] public TextAsset storyFile;
        public StoryPortraitTable portraits;
        [Tooltip("留空用 TMP 預設字型；中文劇本要指定有中文字的字型")] public TMP_FontAsset font;

        // 對話開始與結束：遊戲用來藏 HUD、通知堆疊之類會跟對話框打架的東西
        public event Action Opened;
        public event Action Closed;

        public StorySpeakerRules Speakers { get; set; } = new StorySpeakerRules();
        public PlayerOptions Options { get; set; }

        StoryProject _project;
        IStoryDialogueView _view;
        StoryPresenter _presenter;

        public bool IsPlaying => _presenter != null && _presenter.IsPlaying;
        public string SceneId => IsPlaying ? _presenter.State.SceneId : null;
        public string NodeId  => IsPlaying ? _presenter.State.NodeId  : null;
        public string LastError { get; private set; }
        public IStoryDialogueView View => ViewAlive ? _view : null;

        // 不經 storyFile 直接指定劇本（測試、或劇本從別處載入時）
        public void UseProject(StoryProject project) => _project = project;

        // 換皮：在第一次播放前換掉畫面
        public void UseView(IStoryDialogueView view) => _view = view;

        public StoryProject Project {
            get {
                if (_project != null) return _project;
                if (storyFile == null) {
                    Debug.LogError("[StoryDialogueController] 沒有指定劇本");
                    return null;
                }
                _project = StoryLoader.FromJson(storyFile.text);
                return _project;
            }
        }

        // 一張工作表 = 一個場景；用名稱找（id 每次重新匯入可能不同，名稱是作者自己取的），找不到再當 id
        public string FindSceneId(string key) {
            if (Project == null || string.IsNullOrEmpty(key)) return null;
            string trimmed = key.Trim();
            foreach (var scene in Project.Scenes) if (scene.Name?.Trim() == trimmed) return scene.Id;
            return Project.FindScene(trimmed)?.Id;
        }

        // ── 播放 ─────────────────────────────────────────────

        // variables 為 null 時用一份記憶體內的變數並鋪上宣告的預設值；遊戲要存檔就傳自己的實作
        public IEnumerator Play(string sceneKey, IStoryVariables variables = null) {
            string sceneId = FindSceneId(sceneKey);
            if (sceneId == null) {
                LastError = $"劇本裡沒有場景「{sceneKey}」";
                Debug.LogError($"[StoryDialogueController] {LastError}");
                yield break;
            }
            yield return Run(variables, p => p.Start(sceneId));
        }

        public IEnumerator Resume(string sceneId, string nodeId, IStoryVariables variables) {
            if (Project == null) yield break;
            yield return Run(variables, p => p.Resume(sceneId, nodeId));
        }

        // 中斷目前的劇情；等待中的 coroutine 會看到自己被換掉而結束
        public void Stop() {
            if (_presenter == null) return;
            var presenter = _presenter;
            _presenter = null;
            presenter.Dispose();
            if (ViewAlive) _view.Close();
            Closed?.Invoke();
        }

        // 介面型別的 null 判斷不認得 Unity 已銷毀的物件，要轉回 Object 才看得出來
        bool ViewAlive => _view != null && !(_view is UnityEngine.Object obj && obj == null);

        IEnumerator Run(IStoryVariables variables, Action<StoryPresenter> begin) {
            Stop();
            LastError = null;
            if (variables == null) {
                variables = new InMemoryStoryVariables();
                StoryPlayer.SeedDefaults(Project, variables);
            }
            if (!ViewAlive) _view = StoryDialogueView.Create(font);

            var presenter = new StoryPresenter(_view, Project, variables, portraits, Speakers, Options);
            _presenter = presenter;
            Opened?.Invoke();
            begin(presenter);

            while (_presenter == presenter && presenter.IsPlaying) yield return null;

            if (presenter.State?.Status == PlayerStatus.Error) LastError = presenter.State.Error;
            presenter.Dispose();
            if (_presenter == presenter) {
                _presenter = null;
                Closed?.Invoke();
            }
        }
    }
}
