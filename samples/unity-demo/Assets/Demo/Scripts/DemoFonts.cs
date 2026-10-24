using System.IO;
using TMPro;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;

namespace StoryDemo {

    // 示範專案不附字型檔（repo 是公開的），執行期從系統字型建一份動態 TMP 字型。
    // 正式作品請放自己有授權的字型資產，指定給 StoryDialogueController.font
    public static class DemoFonts {

        static readonly string[] _files = {
            // 可變字型（Noto Sans TC VF）讀出來是預設的細體，排在一般粗細的正黑體後面
            "C:/Windows/Fonts/msjh.ttc",
            "C:/Windows/Fonts/NotoSansTC-VF.ttf",
            "/System/Library/Fonts/PingFang.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        };

        static TMP_FontAsset _cjk;

        public static TMP_FontAsset Cjk() {
            if (_cjk != null) return _cjk;
            foreach (var file in _files) {
                if (!File.Exists(file)) continue;
                _cjk = TMP_FontAsset.CreateFontAsset(file, 0, 90, 9, GlyphRenderMode.SDFAA, 2048, 2048);
                if (_cjk != null) {
                    _cjk.name = Path.GetFileNameWithoutExtension(file);
                    return _cjk;
                }
            }
            Debug.LogWarning("[DemoFonts] 找不到系統中文字型，改用 TMP 預設字型（中文會顯示成方框）");
            return null;
        }
    }
}
