# Story Runtime

播放 StoryEditor 匯出的 `.story.json`。

**目前只有核心層** —— 解析、求值、走訪、TMP 標記與逐字時間表都做好了，
但**對話框、選項 UI、存檔接線還沒有**，也就是還沒有任何東西會出現在畫面上。
見下方「還沒做的」。

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

中途存檔只要記 `state.SceneId` 與 `state.NodeId`，讀檔時從那一句重播。

## 渲染一句台詞

```csharp
// 插值必須在標記解析之前 —— 值裡可能含有標記，順序反過來就不會被渲染。
var filled   = Interpolation.Interpolate(node.Text["zh"], name => LookUp(name));
var parsed   = TagParser.ParseText(filled, project.TagRegistry);
var markup   = TmpMarkup.CreateDefault().Render(parsed);   // TMP rich text
var schedule = Typewriter.Build(parsed);                   // 每個字出現的時刻

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

192 個案例，涵蓋運算式求值、標記解析（逐字比對作用中的標籤）、整場走訪
（狀態、停在哪個節點、走過哪些節點、變數變化）、逐字節奏（每個字的時刻逐位比對）、變數插值與轉義。
錯誤訊息也逐字比對 —— 那些訊息會出現在使用者眼前，是規格的一部分。

**唯一沒有對照的是 TMP 轉換**：網頁端輸出的是 CSS，沒有對應實作可比，
所以那一層的期望值是手寫的，只證明「符合規格」而非「與編輯器一致」。

`Tests~` 的 `~` 讓 Unity 完全忽略這個資料夾，測資不會被匯入成資產。

## 還沒做的

- 對話 UI（TMP 對話框、選項、把時間表接上 coroutine）
- `sfx` 的音效 hook、立繪與音效鍵怎麼對應美術資產
- `shake`／`wave` 的逐頂點動畫（現有劇本 0 次使用，刻意延後）
- 與遊戲既有 StoryManager 的接線

## 已知的落差

`node.condition` 與 `node.actions` 這兩個 schema 欄位，網頁端的 `player.ts`
**沒有實作**，這裡照原樣也不實作以維持兩邊一致。填了會靜默失效。
