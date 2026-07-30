# Story Runtime

播放 StoryEditor 匯出的 `.story.json`。

**目前只有核心層。** 對話 UI、逐字動畫、TMP 渲染、存檔接線都還沒做 —— 見下方「還沒做的」。

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
| `StoryRuntime.Tags` | 特效標記解析（`[b]…[/b]`、`{color=#f00}`、`[wait=0.5]`） |
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

142 個案例，涵蓋運算式求值、標記解析（逐字比對作用中的標籤）、整場走訪
（狀態、停在哪個節點、走過哪些節點、變數變化）。錯誤訊息也逐字比對 ——
那些訊息會出現在使用者眼前，是規格的一部分。

`Tests~` 的 `~` 讓 Unity 完全忽略這個資料夾，測資不會被匯入成資產。

## 還沒做的

- 對話 UI（TMP 對話框、選項、逐字動畫、`speed`／`wait` 的實際效果）
- 標記 → TMP rich text 的轉換
- `sfx` 的音效 hook、立繪與音效鍵怎麼對應美術資產
- `shake`／`wave` 的逐頂點動畫（現有劇本 0 次使用，刻意延後）
- 與遊戲既有 StoryManager 的接線

## 已知的落差

`node.condition` 與 `node.actions` 這兩個 schema 欄位，網頁端的 `player.ts`
**沒有實作**，這裡照原樣也不實作以維持兩邊一致。填了會靜默失效。
