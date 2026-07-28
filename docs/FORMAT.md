# StoryEditor 資料格式規格 v1.0.0

這份文件是**網頁編輯器**與 **Unity runtime** 之間的契約。兩端的實作以此為準。

- 型別的權威定義：[`src/schema/`](../src/schema)（Zod）
- 機器可讀版本：[`docs/story.schema.json`](./story.schema.json)（由 `npm run gen:schema` 產生，改 schema 後必須重跑）
- 可執行的範例：[`samples/demo.story.json`](../samples/demo.story.json)

---

## 0. 最重要的一條規則：id 不可變

所有實體 id 一律使用 **ULID**（26 字元 Crockford Base32）。

**id 一旦建立就永遠不變，也永不重用。** 重新排序、修改文字、搬移場景、刪除後復原 —— 都不得產生新 id。

原因：Excel 雙向同步完全建立在「以 id 對齊」之上。任何會重新產生 id 的流程，都會讓匯入時把譯文靜默地接到錯誤的台詞上 —— 這種錯誤不會報錯，只會在遊戲裡出現。

因此**絕對不要**用 `scene_01_003` 這類含序號的 id：中間插一行，之後全部錯位。

新實體一律經由 [`src/schema/factory.ts`](../src/schema/factory.ts) 建立，不要手刻物件。

---

## 1. 檔案結構

專案檔副檔名 `.story.json`，UTF-8，無 BOM。

```
StoryProject
├── meta            格式版本、專案名、語言清單
├── tagRegistry     特效標籤定義（見 §3）
├── variables       變數宣告
├── characters      角色（含可翻譯的顯示名）
├── scenes[]        場景
│   └── nodes[]     對話節點
│       └── choices[]  選項
└── exportSnapshot  上次匯出 Excel 的內容快照（見 §5）
```

### meta

| 欄位 | 說明 |
|---|---|
| `formatVersion` | 語意化版本。**主版本不符時 runtime 必須明確報錯**，不做隱性相容 |
| `projectName` | 顯示用 |
| `languages` | 語言代碼清單，至少一個 |
| `baseLanguage` | 基準語言，必須在 `languages` 內。缺翻譯時 runtime 回退到這個語言 |
| `updatedAt` | ISO 8601 |

### node

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | ULID | 不可變 |
| `kind` | NodeKind | 預設 `line`，見下 |
| `speaker` | key? | 對應 `characters[].id`；旁白留空 |
| `portrait` | key? | 立繪代號 |
| `text` | `{ [lang]: string }` | 含特效標記，見 §3 |
| `choices` | Choice[] | 空陣列代表沒有分歧 |
| `next` | ULID \| null | `null` 代表場景結束。**有 choices 時忽略 next** |
| `condition` | string? | 不成立時跳過本節點，直接前往 `next` |
| `actions` | Action[] | 進入節點時執行 |
| `audio` | key? | 語音／音效代號 |
| `notes` | string | 給翻譯者的上下文備註，會進 Excel 且可回寫 |
| `expression` | string? | `branch` / `set` / `input` 的運算式 |
| `branches` | Branch[] | `kind` 為 `branch` 時的分支清單，由上而下判斷 |
| `extras` | `{ [欄名]: string }` | 尚未正式支援的製作欄位，原樣保留 |

### node.kind

`line` 以外的種類**不是對白**：它們有 id、會被跳轉指到，但沒有可翻譯的文字，
因此**不會出現在 Excel 的翻譯表**中（否則譯者會看到成排的空列）。

| kind | 意義 | 用到的欄位 |
|---|---|---|
| `line` | 一般台詞。也包含「只有選項、沒有台詞」的純選擇點 | `text` `choices` `next` |
| `branch` | 條件分支，依 `branches` 由上而下判斷，命中即跳轉 | `branches` |
| `set` | 變數賦值 | `expression` `next` |
| `input` | 等待玩家輸入，`expression` 為接收結果的變數名 | `expression` `next` |
| `end` | 場景結束 | — |

### 運算式語言

`branch` 的條件與 `set` 的賦值使用同一套小型運算式語言。**這份語意就是 Unity 端
要照著實作的規格** —— 在編輯器定義一次並寫成測試，比在 C# 裡臨時決定規則便宜得多。

| 類別 | 支援 |
|---|---|
| 字面值 | 數字、字串（`'…'` 或 `"…"`）、`true` / `false` |
| 算術 | `+ - * / %`（`+` 只要有一邊是字串就變成串接） |
| 比較 | `< <= > >= == !=` |
| 邏輯 | `&& \|\| !`（`&&` 與 `\|\|` 短路） |
| 其他 | 括號、函式呼叫 |

真假判定：`0` 與空字串為假，其餘為真。

內建函式：`Max` `Min` `Abs` `Round` `Floor` `Ceil` `Clamp` `Len`，
以及 `CalcAge(出生日, 基準日)`。

> **`CalcAge` 是編輯器預覽用的暫代實作** —— 真正的規則屬於遊戲。
> Unity 端必須提供自己的版本，且兩邊行為要一致，否則預覽與實機會分歧。
> 每個函式都宣告了參數與回傳型別，變數型別就是靠這個推出來的
> （`CalcAge(birthday, …)` 能推出 birthday 是字串，而不是被誤判成數字）。

匯入劇本時，運算式中的變數會自動補上宣告。只被讀取卻從未被賦值的變數
標示為「需由遊戲提供」。

### node.extras

匯入既有劇本時，來源表格常帶著本工具還沒支援的欄位（OST、畫面效果、屬性變化、
背景、插圖…）。與其丟棄，不如原封不動地帶著走 —— 之後要正式支援哪一欄，資料都還在。
編輯器會把它們顯示在節點編輯面板底部：**藏起來的資料等同於遺失的資料**。

### choice

選項**有自己的 ULID**。因為選項文字同樣可翻譯，必須能獨立成為 Excel 的一列並穩定對齊。不要用「父節點 id + 索引」當 key。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | ULID | 不可變 |
| `text` | `{ [lang]: string }` | 選項文字 |
| `targetNodeId` | ULID \| null | `null` 代表結束對話 |
| `condition` | string? | 不成立時該選項不顯示 |

### variable / action

變數 id 是人類可讀的 key（小寫英數、底線、連字號）。

```jsonc
{ "id": "resolve", "type": "number", "default": 0 }
{ "op": "add", "variable": "resolve", "value": 1 }
```

`op` 為 `set` / `add` / `toggle`。`toggle` 僅限 `bool`、不帶 `value`；`add` 僅限 `number`。

### condition 運算式

條件以**字串**保存（例：`met_warden && resolve > 1`）。schema 只保證它是字串，不綁死語法 —— 運算式的解析與驗證由編輯器負責，這樣日後換運算式語法不必改檔案格式。

> 目前 M0 尚未實作運算式解析器，`condition` 為自由字串。M3 補上。

---

## 2. 驗證

`validateStoryProject(data)` 分兩層：

1. **Zod schema** —— 型別與格式
2. **參照完整性**（[`validate.ts`](../src/schema/validate.ts)）—— 跨欄位檢查：id 唯一性、`next` / `targetNodeId` / `speaker` / `actions[].variable` 是否存在、基準語言是否有內容、標籤登錄表是否自洽

參照檢查刻意**不**寫成 Zod 的 `.refine()`：帶 refine 的 schema 無法乾淨轉成 JSON Schema（我們要產一份給 Unity 對照），且扁平的 issue 清單比 Zod 的巢狀 issue 樹好讀。

錯誤分兩級：`error` 阻擋匯出，`warning` 僅提示（例如某語言尚未翻譯）。

---

## 3. 特效標記語法

### 為什麼是內嵌標記而不是區間資料

標記必須能**原封不動地塞進 Excel 的一個儲存格**來回搬運。用區間資料結構（offset + length + effect）的話，翻譯者一改文字長度，所有 offset 就失效了。

### 語法

```
tag      := open '/'? name ( '=' value )? ( WS name '=' value )* close
open     := '[' | '{'
close    := ']' | '}'        （必須與 open 同一組）
value    := bare-token | '"' quoted '"'
```

- **方括號與大括號都可以**：`[b]…[/b]` 與 `{b}…{/b}` 等價。同一個標籤的開頭與結尾
  必須是同一組（`{i}…[/i]` 會報錯），但同一段文字裡兩種可以並存。
- **成對標籤**（`kind: "paired"`）作用於一段文字：`[shake amp=3]活下來[/shake]`
- **單點標籤**（`kind: "inline"`）作用於插入位置：`[wait=0.5]`
- `speed` 刻意設計成成對而非單點：作用範圍明確，也不會發生「改快之後忘了改回來」
- **位置參數簡寫**：標籤若定義了 `positional`，可寫成 `[color=#ff3333]`，等同 `[color value=#ff3333]`
- **數值可用百分比**：`{size=130%}` 等同 `{size=1.3}`（TMP 的 `<size=130%>` 就是這個語意）
- **轉義**：字面上的 `[` 或 `{` 寫作 `\[` `\{`，字面上的 `\` 寫作 `\\`。
  閉括號不需要轉義 —— 它們在標籤外沒有特殊意義。
- 換行直接用字元換行（Excel 儲存格內 Alt+Enter）

範例：

```
[speed=0.6]又一個。[wait=0.4][/speed]你以為換個顏色，就能[shake amp=3]活下來[/shake]嗎？
{i}{color=#606060}（少女回眸一笑。）{/color}{/i}
```

> **為什麼兩種都收**：不同團隊的既定慣例不一樣，逼人改寫幾百句台詞只為了遷就
> 工具是本末倒置。`meta.tagSyntax` 決定工具列插入哪一種，解析永遠兩種都認。
> 匯入的劇本原文一字不動地保存，不會被偷偷正規化成另一種括號。

### 尖括號是變數，不是標記

`<age>`、`<lastName>` 是**變數插值**，會在播放時換成變數當下的值：

```
欸？！<age>歲嗎？……本遊戲的預設等級是25呢。
```

尖括號**不會**被當成特效標記 —— 特效一律用方括號或大括號。兩者分工明確，
所以文字裡的 `a < b` 也不需要轉義。

插值在標記解析**之前**完成，因此替換進來的值若含有標記，那些標記照樣會生效。

找不到對應變數時原樣顯示，並在驗證時列為 warning（多半是打錯字，或誤把特效
寫成了 `<i>` 這種尖括號形式）。

### 標籤登錄表（tagRegistry）

`tagRegistry` 是網頁預覽端與 Unity runtime 端**共用的單一真實來源**：可用的標籤名稱、參數、型別、預設值以此為準，兩端各自實作渲染。

預設標籤集（見 [`tags.ts`](../src/schema/tags.ts)）：

| 標籤 | kind | 參數 | 網頁預覽 | Unity |
|---|---|---|---|---|
| `b` `i` | paired | — | CSS | TMP rich text |
| `color` | paired | `value` (色碼) | `color` | TMP `<color>` |
| `size` | paired | `value` (**倍率**) | `font-size` | TMP `<size=…em>` |
| `font` | paired | `value` (**代號**) | `font-family` | TMP `<font>` |
| `shake` | paired | `amp` `freq` | CSS animation | 逐頂點位移 |
| `wave` | paired | `amp` `freq` | CSS animation | 逐頂點位移 |
| `speed` | paired | `value` (倍率) | typewriter 控制 | typewriter 控制 |
| `wait` | inline | `value` (秒) | typewriter 控制 | typewriter 控制 |
| `sfx` | inline | `value` (代號) | 播放音效 | 播放音效 |

`size` 用**倍率**而非絕對點數、`font` 用**代號**而非字型檔名 —— 兩者都是為了讓同一份文字在網頁 CSS 與 Unity TMP 上都對應得上。

### 不要直接寫 TMP rich text

使用者不應該直接輸入 `<size=150%>` 這種 TMP 語法。原因有二：網頁預覽無法共用；翻譯者一旦寫壞標籤，Unity 端會靜默顯示錯誤內容而不報錯。自訂標籤在編輯器內就能驗證，匯入 Excel 時也能檢查標籤是否被破壞。

### 預期落差

網頁預覽與 Unity 的**斷行、字距、動畫細節不會完全一致**。預覽的定位是「確認節奏與特效意圖」，不是像素級所見即所得。

---

## 4. Excel 交換格式

### 設計原則：Excel 是「文字欄位的可寫視圖」，不是完整資料的鏡像

分支結構、條件運算式、actions **不**放進 Excel 讓人編輯 —— 一格塞不下，也極易寫壞。Excel 只承載可翻譯的文字，結構永遠留在 `.story.json`。

### 工作表

**`Dialogue`** —— 台詞、選項、備註

| 欄 | 可寫 | 說明 |
|---|---|---|
| `row_key` | ✗（隱藏） | 對齊用的 key，格式見下 |
| `scene` | ✗ | 場景名稱 |
| `kind` | ✗ | `line` / `choice` |
| `speaker` | ✗ | 角色顯示名（基準語言） |
| `context` | ✗ | 選項列顯示其父節點台詞；台詞列顯示 condition |
| `notes` | ✓ | 給翻譯者的備註 |
| `text_<lang>` | ✓ | 每個語言一欄，例 `text_zh`、`text_en` |

**`Characters`** —— 角色顯示名

| 欄 | 可寫 | 說明 |
|---|---|---|
| `row_key` | ✗（隱藏） | |
| `char_id` | ✗ | |
| `name_<lang>` | ✓ | |

**`_README`** —— 給翻譯者的規則說明（哪些欄不能動、標籤不能拆）

排版：首列凍結、唯讀欄加底色、`row_key` 欄隱藏。這些是**降低誤改機率**的措施，不是保證 —— 匯入時仍會逐欄比對，唯讀欄的變更一律忽略並列入報告。

### row_key 與 cell key

```
row_key  = <ownerKind>:<ownerId>:<field>          例：node:01KYJ…:text
cell key = <ownerKind>:<ownerId>:<field>:<lang>   例：node:01KYJ…:text:zh
           （非多語系欄位的 lang 為 "-"，例：node:01KYJ…:notes:-）
```

`ownerKind` 為 `node` / `choice` / `character`；`field` 為 `text` / `notes` / `name`。

一列 = 一個 row_key；一格 = 一個 cell key。快照與合併都以 **cell key** 為單位（見 [`keys.ts`](../src/schema/keys.ts)）。

列的順序是「場景 → 節點 → 該節點的選項 → 角色」，讓翻譯者能照劇情順序閱讀。因為 key 與順序無關，重排不影響合併。

---

## 5. 三方合併（雙向同步）

### 為什麼需要快照

編輯器與 Excel 兩邊都可能被修改。沒有「上次匯出時的內容」當基準，就無法分辨「Excel 改了」與「編輯器改了」，匯入只能退化成整份覆蓋。

因此每次匯出時，把當下所有可寫格的內容存成 `exportSnapshot`（cell key → 字串）寫回專案檔。

### 合併規則

對每一格，比較三個值：`base`（快照）、`current`（編輯器現況）、`incoming`（Excel）。

| 情況 | 動作 |
|---|---|
| `incoming == base` | 對方沒動 → **跳過** |
| `incoming != base` 且 `current == base` | 只有 Excel 改了 → **套用** |
| `incoming != base` 且 `current != base` 且 `incoming != current` | 兩邊都改了 → **標記衝突** |
| `incoming != base` 且 `incoming == current` | 兩邊改成一樣 → 跳過 |
| row_key 不存在於專案 | **未知列**，不自動新增 |
| 專案中的 row_key 不在 Excel 內 | **缺列**，不自動刪除 |
| 唯讀欄被改動 | 忽略，列入報告 |
| 標記語法被破壞 | 視同衝突，不得靜默套用 |

沒有快照時（首次匯入、或快照遺失），全部視為衝突交由使用者決定，**不預設覆蓋**。

套用前顯示匯入報告：新增 / 修改 / 衝突 / 未知列 / 缺列，逐項可勾選。衝突提供三選一：保留現況 / 採用 Excel / 手動編輯。

> M0 只定義規則與 key；合併演算法在 M4 實作。

---

## 6. 版本規則

`meta.formatVersion` 採語意化版本：

- **主版本**變更 = 破壞性變更。Unity runtime 讀到不同主版本必須明確報錯並停止載入。
- **次版本**變更 = 新增選填欄位。舊 runtime 可忽略未知欄位繼續運作。

**讀取舊檔時必須使用 Zod 的輸出，不能沿用原始 JSON。**
`validateStoryProject()` 回傳的 `project` 已套用所有 `.default()`；直接用傳進去的
物件會讓舊檔缺少的新欄位維持 `undefined`，然後在第一次存取時炸掉 ——
「舊檔照讀」的承諾就是斷在這一行上。

### 版本紀錄

| 版本 | 變更 |
|---|---|
| 1.2.0 | 新增 `node.source` / `sourceJump`、`choice`／`branch` 的 `sourceId` / `sourceJump` / `speaker` / `extras`、`scene.sourceColumns`。記住每個實體來自來源劇本表的哪一列，使匯出能還原原本的欄位與編號 |
| 1.1.0 | 新增 `node.kind` / `expression` / `branches` / `extras`；`portrait` 由 key 放寬為自由字串（美術資產常用中文命名） |
| 1.0.0 | 初版 |

改動 Zod schema 後，必須重跑 `npm run gen:schema` 並把 `docs/story.schema.json` 的 diff 一併提交 —— 那份 diff 就是格式變更的記錄。
