using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using StoryRuntime.Tags;
using Xunit;

namespace StoryRuntime.Tests {

    // 標記 → TMP rich text。
    //
    // 這一層**沒有黃金測資**，因為網頁端沒有對應的實作可比 —— 它輸出的是 CSS。
    // 期望值是手寫的，所以只證明「符合我們定義的規格」，不像其他四層那樣
    // 證明了「與編輯器一致」。等網頁預覽哪天也改用 TMP 語法渲染，這層就該補上對照。
    public class TmpMarkupTests {

        static readonly List<TagDef> Registry =
            JsonConvert.DeserializeObject<List<TagDef>>(
                ((JObject)GoldenData.Load("tags.json"))["registry"].ToString());

        static string Render(string source) =>
            TmpMarkup.CreateDefault().Render(TagParser.ParseText(source, Registry));

        [Theory]
        [InlineData("沒有標記", "沒有標記")]
        [InlineData("[b]粗[/b]", "<b>粗</b>")]
        [InlineData("[i]斜[/i]", "<i>斜</i>")]
        [InlineData("[b]粗[i]又斜[/i][/b]", "<b>粗<i>又斜</i></b>")]
        [InlineData("前[b]中[/b]後", "前<b>中</b>後")]
        public void BasicPairs(string source, string expected) => Assert.Equal(expected, Render(source));

        [Theory]
        [InlineData("{color=#606060}灰{/color}", "<color=#606060>灰</color>")]
        [InlineData("[color=#f00]紅[/color]", "<color=#f00>紅</color>")]
        public void Color(string source, string expected) => Assert.Equal(expected, Render(source));

        // 標記裡是倍率、TMP 吃百分比，而 1.3 * 100 在浮點數裡是 130.00000000000003。
        [Theory]
        [InlineData("{size=130%}大{/size}", "<size=130%>大</size>")]
        [InlineData("[size=0.5]小[/size]", "<size=50%>小</size>")]
        [InlineData("[size=1]原樣[/size]", "<size=100%>原樣</size>")]
        public void SizeBecomesPercentage(string source, string expected) =>
            Assert.Equal(expected, Render(source));

        // 字型名常含空格，不加引號 TMP 會解析失敗。
        [Fact]
        public void FontIsQuoted() =>
            Assert.Equal("<font=\"Noto Serif TC\">字</font>", Render("[font=\"Noto Serif TC\"]字[/font]"));

        // shake / wave 還沒做（要逐頂點動畫），但文字必須照樣出現。
        [Theory]
        [InlineData("[shake amp=3]抖[/shake]", "抖")]
        [InlineData("[wave]浪[/wave]", "浪")]
        [InlineData("前[shake]中[/shake]後", "前中後")]
        public void UnmappedPairsStillShowText(string source, string expected) =>
            Assert.Equal(expected, Render(source));

        // 單點標籤是給逐字動畫用的，不產生任何標記。
        [Theory]
        [InlineData("停[wait=0.5]頓", "停頓")]
        [InlineData("[speed=0.5]慢[/speed]", "慢")]
        [InlineData("[sfx=door]開門", "開門")]
        public void InlineTagsProduceNoMarkup(string source, string expected) =>
            Assert.Equal(expected, Render(source));

        [Fact]
        public void RealScriptPattern() =>
            Assert.Equal(
                "<i><color=#606060>（旁白）</color></i>",
                Render("{i}{color=#606060}（旁白）{/color}{/i}"));

        // 逐字動畫直接用索引推進，所以可見字元數必須與 ParsedText.Chars 一致。
        [Theory]
        [InlineData("{i}{color=#606060}（旁白）{/color}{/i}")]
        [InlineData("[b]粗[/b]停[wait=1]頓[shake]抖[/shake]")]
        [InlineData("\\[轉義\\]")]
        public void VisibleCharCountMatchesParsedChars(string source) {
            ParsedText parsed = TagParser.ParseText(source, Registry);
            string rendered = TmpMarkup.CreateDefault().Render(parsed);

            // 把所有 <…> 標記拿掉之後，剩下的就該等於 plain。
            string stripped = System.Text.RegularExpressions.Regex.Replace(rendered, "<[^>]*>", "");
            Assert.Equal(parsed.Plain, stripped);
        }

        [Fact]
        public void MappingsCanBeReplaced() {
            var map = TmpMarkup.CreateDefault();
            map.Add("shake", (tag, open, close) => {
                open.Append("<rotate=5>");
                close.Append("</rotate>");
            });
            Assert.Equal(
                "<rotate=5>抖</rotate>",
                map.Render(TagParser.ParseText("[shake]抖[/shake]", Registry)));

            map.Remove("b");
            Assert.Equal("粗", map.Render(TagParser.ParseText("[b]粗[/b]", Registry)));
        }
    }
}
