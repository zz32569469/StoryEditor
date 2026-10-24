# Story Runtime

播放 StoryEditor 匯出的 `.story.json`。

核心層（解析、求值、走訪、TMP 標記、逐字時間表、演出欄位）加上一套可換皮的預設對話介面（`StoryRuntime.UI`）。
演出欄位的寫法見 [`docs/FORMAT.md` §3.5](../docs/FORMAT.md)。

## 為什麼核心層不引用 UnityEngine

`Runtime/StoryRuntime.asmdef` 設了 `noEngineReferences: true`，Unity 會強制擋下任何
`UnityEngine` 引用。這不是潔癖：**核心層因此能在 Unity 之外用 `dotnet test` 跑**，
而測試要比對的是「行為跟網頁編輯器一不一樣」，那件事跟引擎無關。

`tools/csharp/StoryRuntime.Core.csproj` 鎖 `netstandard2.1`（Unity 的 API 相容層級），
所以在那裡編得過，在 Unity 裡也編得過。

## 三層

| 命名空間 | 內容 |
|---|---|
| `StoryRuntime.Expressions` | 條件與賦值的 tokenizer、Pratt parser、求值器 |
| `StoryRuntime.Tags` | 特效標記解析、TMP rich text 轉換、逐字播放時間表 |
| `StoryRuntime.Story` | `.story.json` 的 DTO、Newtonsoft 載入、走訪狀態機 |
| `StoryRuntime.UI` | 預設對話介面（原型 UI25）：`StoryDialogueController`、`StoryPresenter`、`StoryDialogueView`、`StoryPortraitTable` |

`StoryRuntime.UI` 引用 UnityEngine、uGUI 與 TextMeshPro，但**不依賴任何遊戲程式**。

## 預設對話介面

```csharp
var controller = gameObject.AddComponent<StoryDialogueController>();
controller.storyFile = storyJson;        // TextAsset
controller.portraits = portraitTable;    // 立繪代號 → Sprite
controller.font      = cjkFont;          // 中文劇本要指定有中文字的 TMP 字型
yield return controller.Play("第一章");   // 用工作表名稱找場景，播完才回來
```

- **閱讀規則**（原型 UI25）：每字 35ms、句末標點之後停 150ms；點一下先補完當句，完整後再點才前進；
  AUTO 整句顯示完後停 max(1400, min(5000, 字數×65)) ms，每次新對話重設為關，分支與輸入不代選。
- **外觀**：對話框左右距 48、下距 22、高 146～310、文字 19px 行高 1.7，文字區與分支列表超過 240 就捲動；
  名稱牌在左上、AUTO 在右上；立繪寬 344、頂距 104，「右」格距右邊 104（原型的單人位置），不是說話者的立繪下移 10px；
  旁白、系統、內心話（`… os`／`… mind`）套全景色罩 `#17222c20`。原型的數值以 1024×768 設計，畫布 1280×960 一律 ×1.25。
- **說話者規則**：`StorySpeakerRules` 決定誰算旁白類、名牌寫什麼（`mc`／`player` 與其內心話寫「我」、
  `店長 os` 寫「店長」）。各作品用 `Override` 加自己的對照。
- **換皮**：實作 `IStoryDialogueView`，用 `controller.UseView(...)` 換掉。Presenter 只認介面，計時在 View、判斷在 Presenter。
- **遊戲接線**：`Opened`／`Closed` 事件讓遊戲藏自己的 HUD；變數傳自己的 `IStoryVariables` 才會進存檔。

### 閱讀輔助

對話框右上 AUTO 左邊一排按鈕（由右往左）：SKIP、LOG、速度、快讀、快存、隱藏。

- **對話紀錄（LOG／滾輪往上）**：看過的台詞、選過的選項、填過的輸入，預設保留 300 筆（`backlogCapacity`），
  超過丟掉最舊的。打開時停下 AUTO 與略過；「關閉」、右鍵、Esc 收起。
- **略過（SKIP）**：只快轉讀過的句子（每句 0.05 秒），碰到沒讀過的句子、選項、輸入就停；略過中點一下也停。
  讀過的句子記在 `controller.ReadHistory`，要跟遊戲存檔一起存（`Keys`／`Load`）才分得出新舊。
- **文字速度**：慢 ×0.5、普通、快 ×2、瞬間（整句直接出現），倍率同時套在每字時間與句末停頓。
  玩家切換後寫回 `controller.textSpeed`，下一場沿用；要記到設定檔由遊戲自己存。
- **快存／快讀**：一格，內容是停在哪一句、劇本宣告的變數值、讀過的句子、對話紀錄（`StoryQuickSave`，可整份轉 JSON）。
  預設存成 `persistentDataPath/story-quicksave.json`；`controller.QuickSaves` 可換成遊戲自己的存放處，
  或設 `controller.QuickSaveHandler` 把快存快讀整個交給遊戲的存檔系統（存成遊戲存檔的一格）。
- **隱藏（右鍵）**：收起對話框看全畫面；再點一下、右鍵、Space 或 Enter 叫回來，那一下不會前進。

### 演出

`StoryPlayer` 每一步回傳 `state.Cues`（經過的、有演出欄位的節點／選項／分支，依序）與 `state.Effects`
（屬性變化，已依屬性清單套到變數上）。Presenter 照 Cues 執行：同一列先換背景與插圖（有「溶接」就交叉淡化），
再播畫面效果；效果音、BGM 交給 `IStoryAudio`；物品消耗、功能解鎖、屬性變化、舊寫法的輸入提示（`OpenNameInput`）
用控制器的事件交給遊戲。台詞裡的 `[sfx=代號]` 在逐字顯示到那個字時播放（點擊補完整句時略過）。

```csharp
controller.backgrounds = backgroundTable;   // StorySpriteTable：「背景」欄代號 → 圖
controller.cgs         = cgTable;           // StorySpriteTable：「插圖」欄代號 → 圖
controller.audioTable  = audioTable;        // StoryAudioTable：效果音、OST 代號 → 音檔（或 UseAudio 接遊戲自己的音效系統）
controller.AttributesChanged += effects => ...;
controller.ItemsConsumed     += (items, target) => ...;
controller.FeaturesUnlocked  += keys => ...;
```

- 背景、插圖、黑幕、眼皮、閃白都在對話框下面；只有「震動」連對話框一起晃。
- 對應表裡沒有的代號（例如只寫「插圖」的佔位）跳過並記 warning，不清掉目前的畫面。
- 立繪可以左／中／右同時多人，進退場有淡入淡出與左右滑入滑出；沒寫位置的角色站 `controller.defaultPortraitSlot`（預設「右」），
  站到有人的格子會把原本那位換下，所以沒寫位置的劇本看起來跟單人立繪一樣。
- 讀檔（`ResumeAt`）時，往回找存檔那一句之前最後的背景、插圖、BGM 與立繪站位直接放上去；那一句的屬性變化不會重複套用。
- 台詞裡的 `[shake]`／`[wave]` 用逐頂點動畫做（`TextMotion` 算位移，振幅與頻率照網頁預覽的 CSS）；
  shake 每個字錯開一格，比網頁的整段同步抖更像「逐字抖動」。
- 鍵盤（Space／Enter 前進、Esc 關 AUTO）只接舊版 Input Manager；只開新版 Input System 的專案要自己把按鍵接上。

## 示範專案

[`samples/unity-demo`](../samples/unity-demo) 是只引用這個套件的最小 Unity 專案（6000.4.4f1），
用來跑 Play Mode 驗證與截圖。第一次開啟前先跑一次設定（匯入 TMP 基本資源、建立立繪表與示範場景）：

```bash
Unity -batchmode -projectPath samples/unity-demo -executeMethod StoryDemo.Editor.DemoSetup.Run
Unity -batchmode -projectPath samples/unity-demo -runTests -testPlatform EditMode -testResults results.xml
```

套件自己的 EditMode 測試（`Tests/Editor`）透過示範專案的 `testables` 一起跑；截圖寫到 `samples/unity-demo/Screenshots/`。
示範專案不附字型檔，執行期從系統字型（微軟正黑體等）建立動態 TMP 字型。

## 變數由遊戲擁有

runtime **不存任何狀態**。實作 `IStoryVariables` 把讀寫接到你自己的存檔：

```csharp
sealed class GameVariables : IStoryVariables {
    public bool TryGet(string name, out StoryValue value) { ... }
    public void Set(string name, StoryValue value) { ... }
}
```

`composure` 這種遊戲變數接到既有欄位，劇本專用的接到存檔裡的字典。
少了這條界線，同一個變數會在 runtime 與存檔各留一份而漸漸不同步。

## 播放

```csharp
var project = StoryLoader.FromJson(textAsset.text);
var state = StoryPlayer.StartScene(project, sceneId, variables);
// state.Status：Line / Choices / Input / Ended / Error
state = StoryPlayer.Advance(project, state, variables);
state = StoryPlayer.Choose(project, state, choiceId, variables);
state = StoryPlayer.SubmitInput(project, state, values, variables);
```

`StartScene` **不會**自己鋪變數預設值 —— 那會在每次進劇情時把遊戲狀態重設掉。
需要時自己呼叫 `StoryPlayer.SeedDefaults(project, variables)`（新遊戲開始時）。
`SeedDefaults` 會整批覆蓋；已經接到遊戲欄位的變數（composure 之類）不能這樣鋪，
改用 `StoryPlayer.DefaultValueOf(variable)` 只補劇本專用、還沒有值的那幾個。

狀態型別叫 `StoryState`（網頁端叫 `PlayerState`）—— 遊戲多半已經有自己的 `PlayerState`，
同名會讓 `using StoryRuntime.Story` 編譯失敗。

### 選項解鎖

選項的 `condition` 不成立時玩家看不到它。判斷在**抵達選項那一刻**做一次，結果放在
`state.AvailableChoices`（依劇本順序的 id）：UI 只照這份顯示，`Choose` 也只收這份裡的 id，
選了名單外的會變成 `Error`。全部選項都不成立也是 `Error` —— 不然畫面會停在一個沒有按鈕可按的地方。

### 存讀檔

中途存檔只要記 `state.SceneId` 與 `state.NodeId`。讀檔用
`StoryPlayer.ResumeAt(project, sceneId, nodeId, variables)` 回到那一句的開頭：
存檔只會停在台詞、選項、輸入這些節點，所以不會重跑任何 `set`；選項的解鎖條件則依讀檔當下的變數重新判斷。

## 渲染一句台詞

```csharp
// 插值必須在標記解析之前 —— 值裡可能含有標記，順序反過來就不會被渲染。
var filled   = Interpolation.Interpolate(node.Text["zh"], name => LookUp(name));
var parsed   = TagParser.ParseText(filled, project.TagRegistry);
var markup   = TmpMarkup.CreateDefault().Render(parsed);   // TMP rich text
var schedule = Typewriter.Build(parsed);                   // 每個字出現的時刻
// 句末停頓：Typewriter.Build(parsed, 1 / 0.035, 0.15) —— 每字 35ms、。！？!?… 之後停 150ms（預設 0 不停）

label.text = markup;
label.maxVisibleCharacters = schedule.VisibleAt(elapsedSeconds);
```

**可見字元的順序與數量跟 `parsed.Chars` 完全一致** —— 標記只插在字與字之間，
所以第 i 個字就是 TMP 的第 i 個可見字元，`maxVisibleCharacters` 可以直接用索引推進。

這個對應關係**已在 Unity 6000.4.4f1 實測確認**（2026-08，TextMeshPro）：
`maxVisibleCharacters` 數的與 `textInfo.characterCount` 是同一組，**空白與換行
雖然 `isVisible == false`，仍佔一個索引**。所以：

| 輸入 | TMP characterCount | 我們的 `Chars.Count` |
|---|---|---|
| `<i><color=#606060>（旁白）</color></i>` | 4 | 4 |
| `第一行` + 換行 + `第二行` | 7 | 7 |
| `有 空白 的 句子` | 9 | 9 |
| `<size=130%>大</size>小` | 2 | 2 |

實測 `有 空白 的 句子`：`maxVisibleCharacters = 2` 只露出「有」（索引 1 是空白，
佔了額度但不顯示），`= 3` 才變成「有空」。逐字動畫直接用索引推進是安全的。

插值會把值裡的 `<` 換成全形 `＜`。玩家自己打的名字會被插進台詞、台詞最後餵給 TMP，
名字裡的 `<size=500%>` 能把整段字撐爆 —— 尖括號在這套系統裡按定義就不是標記
（它專屬變數插值），值裡出現它沒有正當用途。方括號與大括號**刻意不動**，
值裡放標記是既有且有意的能力。轉義是一換一，逐字動畫的索引不受影響。

`sfx` 這類要在特定字觸發的事件，直接讀 `parsed.Chars[i].Before` 自己處理，
時間表只負責時機。

標籤 → TMP 的對應表可以改：

```csharp
var map = TmpMarkup.CreateDefault();
map.Add("shake", (tag, open, close) => { open.Append("<rotate=5>"); close.Append("</rotate>"); });
```

對應表刻意**不放進 `.story.json`**：registry 描述的是「這個標籤有哪些參數」，
那是編輯器與 runtime 共用的契約；「在 TMP 裡長什麼樣」只有 Unity 端在乎。

## 遊戲要自己提供的函式

`CalcAge` 的內建版本是**預覽暫代**，真正的規則屬於遊戲。用 `PlayerOptions.Functions`
覆蓋同名函式：

```csharp
var options = new PlayerOptions {
    Functions = new Dictionary<string, HostFunction> {
        ["CalcAge"] = new HostFunction { Arity = 2, /* 你的規則 */ },
    },
};
```

覆蓋後**務必**同步更新編輯器端的實作，否則預覽與實機會分歧。

## 行為怎麼保證與編輯器一致

`Tests~/golden/` 下的測資由 `npm run gen:golden` 從**編輯器實際使用的程式碼**產生，
期望值不是手寫的。C# 端讀同一份跑一遍：

```bash
npm run gen:golden
cd tools/csharp/StoryRuntime.Tests && dotnet test
```

230 個案例，涵蓋運算式求值、標記解析（逐字比對作用中的標籤）、整場走訪
（狀態、停在哪個節點、走過哪些節點、看得到哪些選項、變數變化）、逐字節奏（每個字的時刻逐位比對）、變數插值與轉義。
錯誤訊息也逐字比對 —— 那些訊息會出現在使用者眼前，是規格的一部分。

**沒有對照的是 TMP 轉換與 `ResumeAt`**（網頁預覽不讀檔）。TMP 轉換：網頁端輸出的是 CSS，沒有對應實作可比，
所以那一層的期望值是手寫的，只證明「符合規格」而非「與編輯器一致」。

`Tests~` 的 `~` 讓 Unity 完全忽略這個資料夾，測資不會被匯入成資產。

## 還沒做的

- 快速存檔只有一格；多存檔欄位、存檔縮圖交給遊戲自己的存檔畫面

## 已知的落差

`node.condition` 與 `node.actions` 這兩個 schema 欄位，網頁端的 `player.ts`
**沒有實作**，這裡照原樣也不實作以維持兩邊一致。填了會靜默失效。
