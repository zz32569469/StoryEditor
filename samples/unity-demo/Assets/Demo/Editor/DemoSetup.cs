using System.IO;
using StoryRuntime.UI;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace StoryDemo.Editor {

    // 第一次開啟示範專案（或在 CI 上）跑一次（batch mode 不要加 -quit，做完會自己結束）：
    //   Unity -batchmode -projectPath samples/unity-demo -executeMethod StoryDemo.Editor.DemoSetup.Run
    // 匯入 TMP 基本資源、把佔位圖設成 Sprite、建立立繪對應表與示範場景。重跑不會重複建立
    public static class DemoSetup {

        const string ArtRoot      = "Assets/Demo/Art";
        const string PortraitDir  = ArtRoot + "/Portraits";
        const string AudioDir     = "Assets/Demo/Audio";
        public const string PortraitTable   = "Assets/Demo/DemoPortraits.asset";
        public const string BackgroundTable = "Assets/Demo/DemoBackgrounds.asset";
        public const string CgTable         = "Assets/Demo/DemoCgs.asset";
        public const string AudioTable      = "Assets/Demo/DemoAudio.asset";
        // 中性範例劇本放在示範專案外（samples/），跟網頁編輯器共用同一份
        public const string SampleCafe      = "../sample-cafe.story.json";
        public const string ScenePath     = "Assets/Demo/Demo.unity";
        public const string WalkStory     = "Assets/Demo/Stories/ui-walk.story.json";
        public const string Background    = ArtRoot + "/Backgrounds/店內-白天.png";

        [MenuItem("Story Demo/重新設定示範專案")]
        public static void Run() {
            // TMP 沒有 TMP Settings 時一建立文字就丟 NullReference；基本資源由 ugui 套件附帶，不進版控。
            // ImportPackage 是非同步的（batch mode 也一樣），要等完成回呼才能往下做，否則 -quit 會先結束
            if (AssetDatabase.FindAssets("t:TMP_Settings").Length == 0) {
                AssetDatabase.importPackageCompleted += OnImported;
                AssetDatabase.importPackageFailed += OnImportFailed;
                string package = Path.GetFullPath("Packages/com.unity.ugui/Package Resources/TMP Essential Resources.unitypackage");
                AssetDatabase.ImportPackage(package, false);
                return;
            }
            Finish();
        }

        static void OnImported(string _) {
            AssetDatabase.importPackageCompleted -= OnImported;
            AssetDatabase.importPackageFailed -= OnImportFailed;
            Finish();
        }

        static void OnImportFailed(string name, string error) {
            Debug.LogError($"[DemoSetup] 匯入 {name} 失敗：{error}");
            if (Application.isBatchMode) EditorApplication.Exit(1);
        }

        static void Finish() {
            ConfigureSprites();
            BuildPortraitTable();
            BuildSpriteTable<StorySpriteTable>(BackgroundTable, ArtRoot + "/Backgrounds");
            BuildSpriteTable<StorySpriteTable>(CgTable, ArtRoot + "/CGs");
            BuildAudioTable();
            BuildScene();
            AssetDatabase.SaveAssets();
            Debug.Log("[DemoSetup] 完成");
            if (Application.isBatchMode) EditorApplication.Exit(0);
        }

        static void ConfigureSprites() {
            foreach (string guid in AssetDatabase.FindAssets("t:Texture2D", new[] { ArtRoot })) {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                var importer = (TextureImporter)AssetImporter.GetAtPath(path);
                if (importer.textureType == TextureImporterType.Sprite && !importer.mipmapEnabled) continue;
                importer.textureType = TextureImporterType.Sprite;
                importer.spriteImportMode = SpriteImportMode.Single;
                importer.mipmapEnabled = false;
                importer.alphaIsTransparency = true;
                importer.SaveAndReimport();
            }
        }

        // 代號 = 檔名（例「店長-微笑」），跟劇本「立繪」欄寫的一樣
        static void BuildPortraitTable() => BuildSpriteTable<StoryPortraitTable>(PortraitTable, PortraitDir);

        static void BuildSpriteTable<T>(string assetPath, string folder) where T : StorySpriteTable {
            var table = AssetDatabase.LoadAssetAtPath<T>(assetPath);
            if (table == null) {
                table = ScriptableObject.CreateInstance<T>();
                AssetDatabase.CreateAsset(table, assetPath);
            }
            table.entries.Clear();
            foreach (string guid in AssetDatabase.FindAssets("t:Sprite", new[] { folder })) {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                table.entries.Add(new StorySpriteTable.Entry {
                    key = Path.GetFileNameWithoutExtension(path),
                    sprite = AssetDatabase.LoadAssetAtPath<Sprite>(path),
                });
            }
            table.entries.Sort((a, b) => string.CompareOrdinal(a.key, b.key));
            table.Invalidate();
            EditorUtility.SetDirty(table);
        }

        static void BuildAudioTable() {
            var table = AssetDatabase.LoadAssetAtPath<StoryAudioTable>(AudioTable);
            if (table == null) {
                table = ScriptableObject.CreateInstance<StoryAudioTable>();
                AssetDatabase.CreateAsset(table, AudioTable);
            }
            table.entries.Clear();
            foreach (string guid in AssetDatabase.FindAssets("t:AudioClip", new[] { AudioDir })) {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                table.entries.Add(new StoryAudioTable.Entry {
                    key = Path.GetFileNameWithoutExtension(path),
                    clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path),
                });
            }
            table.entries.Sort((a, b) => string.CompareOrdinal(a.key, b.key));
            table.Invalidate();
            EditorUtility.SetDirty(table);
        }

        static void BuildScene() {
            if (File.Exists(ScenePath)) return;
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            var boot = new GameObject("Story Demo").AddComponent<DemoBootstrap>();
            boot.storyFile  = AssetDatabase.LoadAssetAtPath<TextAsset>(WalkStory);
            boot.portraits  = AssetDatabase.LoadAssetAtPath<StoryPortraitTable>(PortraitTable);
            boot.background = AssetDatabase.LoadAssetAtPath<Sprite>(Background);
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }
    }
}
