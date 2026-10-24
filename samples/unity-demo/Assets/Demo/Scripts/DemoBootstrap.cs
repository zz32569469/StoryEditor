using System.Collections;
using StoryRuntime.UI;
using UnityEngine;
using UnityEngine.UI;

namespace StoryDemo {

    // 示範場景的入口：鋪一張背景、建立對話控制器、把指定的場景播完後重來一次
    public class DemoBootstrap : MonoBehaviour {

        public TextAsset storyFile;
        public StoryPortraitTable portraits;
        public Sprite background;
        public string sceneName = "開幕前一天";

        public StoryDialogueController Controller { get; private set; }

        void Awake() {
            if (background != null) CreateBackground(background);
            Controller = gameObject.AddComponent<StoryDialogueController>();
            Controller.storyFile = storyFile;
            Controller.portraits = portraits;
            Controller.font = DemoFonts.Cjk();
        }

        IEnumerator Start() {
            while (true) {
                yield return Controller.Play(sceneName);
                yield return new WaitForSeconds(1f);
            }
        }

        public static Canvas CreateBackground(Sprite sprite) {
            var canvas = StoryUiKit.CreateOverlayCanvas("Demo Background", 0, StoryDialogueView.ReferenceResolution);
            var image = StoryUiKit.Stretch(StoryUiKit.Rect("Background", canvas.transform)).gameObject.AddComponent<Image>();
            image.sprite = sprite;
            image.preserveAspect = true;
            image.raycastTarget = false;
            return canvas;
        }
    }
}
