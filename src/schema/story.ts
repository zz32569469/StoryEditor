import { z } from 'zod';
import { DECLARED_TYPES } from '../expr/evaluate';
import { IdentifierSchema, KeySchema, LangCodeSchema, UlidSchema } from './ids';
import { TagRegistrySchema, TagSyntaxSchema } from './tags';

/**
 * 格式版本。Unity runtime 讀到不符的 major 版本必須明確報錯，不做隱性相容。
 *
 * 1.1.0：新增 node.kind / expression / branches / extras，用以承接既有劇本中的
 *        流程控制列（if / set / in / end）與製作欄位。全為選填，1.0.0 的檔案照讀。
 * 1.2.0：新增 source / sourceId / sourceColumns，記住每個實體來自來源表的哪一列，
 *        讓劇本能以原本的欄位與編號匯出回去。全為選填。
 * 1.3.0：變數型別新增 `date`（執行期仍是字串）。舊檔照讀；
 *        但含 date 的檔案給 1.2.0 以前的讀取端會失敗。
 */
export const FORMAT_VERSION = '1.3.0';

/**
 * 多語系文字。key 為語言代碼，value 為含特效標記的字串。
 * 缺語言代表尚未翻譯，runtime 應回退到 baseLanguage。
 */
export const LocalizedTextSchema = z.record(LangCodeSchema, z.string());
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/**
 * 條件與運算式一律以字串保存（例：`flags.met_boss && hearts > 1`）。
 * 編輯器負責解析與驗證；此處只保證它是字串，避免 schema 綁死運算式語法。
 */
export const ExpressionSchema = z.string();

/**
 * 這個實體來自來源劇本表的哪一列。
 *
 * 保留它才能把專案以**原本的欄位與編號**匯出回去 —— 少了原始 ID，
 * 匯出時只能重新編號，任何依賴那些編號的既有流程都會對不上。
 * 編輯器新增的內容沒有 source，匯出時才配發不重複的新編號。
 */
export const SourceRowSchema = z.object({
  /** 來源表的 ID 欄。 */
  id: z.string(),
  /** 來源表的標誌欄原值（空字串與 `#` 都是台詞，要分辨才能原樣寫回）。 */
  marker: z.string().default(''),
  /** 來源表的組欄。 */
  group: z.string().default(''),
});
export type SourceRow = z.infer<typeof SourceRowSchema>;

/**
 * 來源表的跳轉原值。
 *
 * 選項與分支在編輯器裡指向「群組節點」，但來源的跳轉可以精確指到群組中的
 * 某一列（同組成員之間互跳確實存在）。保留原值，匯出時若目標沒被改動就
 * 原樣寫回；改過了才用新解析出的編號。
 */
export const SourceJumpSchema = z.string();

/** 尚未有正式欄位的製作資訊，原樣保留。key 為來源表的欄名。 */
export const ExtrasSchema = z.record(z.string(), z.string());

/**
 * 型別清單由運算式引擎提供，避免兩邊各維護一份而漂移。
 * 「日期」在執行期就是字串，只是介面上另外看待（見 evaluate.ts 的 storageType）。
 */
export const VariableTypeSchema = z.enum(DECLARED_TYPES);
export type VariableType = z.infer<typeof VariableTypeSchema>;

export const VariableSchema = z.object({
  id: IdentifierSchema,
  type: VariableTypeSchema,
  default: z.union([z.boolean(), z.number(), z.string()]),
  description: z.string().default(''),
});
export type Variable = z.infer<typeof VariableSchema>;

export const ActionSchema = z.object({
  op: z.enum(['set', 'add', 'toggle']),
  variable: IdentifierSchema,
  /** `toggle` 不需要 value。 */
  value: z.union([z.boolean(), z.number(), z.string()]).optional(),
});
export type Action = z.infer<typeof ActionSchema>;

/**
 * 立繪代號刻意是自由字串而非 KeySchema。
 *
 * 它是美術資產的查找鍵，實務上常直接用中文命名（例如「便服-微笑」）。
 * 強制英數會逼使用者為既有素材重新命名，或在轉檔時把資訊絞碎。
 */
export const PortraitKeySchema = z.string();

export const CharacterSchema = z.object({
  id: KeySchema,
  /** 角色顯示名也需要翻譯，因此同樣進 Excel。 */
  name: LocalizedTextSchema,
  defaultPortrait: PortraitKeySchema.optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

/**
 * 選項。
 *
 * choice 有自己的 ULID —— 因為選項文字同樣可翻譯，必須能獨立成為 Excel 的一列
 * 並在合併時穩定對齊。不要用「父節點 id + 索引」當 key，插入選項就會全錯位。
 */
export const ChoiceSchema = z.object({
  id: UlidSchema,
  text: LocalizedTextSchema,
  /** null 代表結束對話。 */
  targetNodeId: UlidSchema.nullable().default(null),
  condition: ExpressionSchema.optional(),
  /** 來源表的 ID —— 選項在來源中各自是一列。 */
  sourceId: z.string().optional(),
  sourceJump: SourceJumpSchema.optional(),
  /**
   * 同一組的選項可以標不同人物（例如「（不介入）」是 system 而非玩家），
   * 因此說話者掛在選項上，而非整組共用節點的說話者。
   */
  speaker: KeySchema.optional(),
  extras: ExtrasSchema.default({}),
});
export type Choice = z.infer<typeof ChoiceSchema>;

/**
 * 節點種類。
 *
 * `line` 以外的種類不是對白，而是流程控制 —— 它們有 id、會被跳轉指到，
 * 但沒有可翻譯的文字，因此不會出現在 Excel 的翻譯表中。
 */
export const NodeKindSchema = z.enum([
  /** 一般台詞（也包含「只有選項、沒有台詞」的純選擇點）。 */
  'line',
  /** 條件分支：依 branches 逐條判斷，命中即跳轉。 */
  'branch',
  /** 變數賦值，運算式放在 expression。 */
  'set',
  /** 等待玩家輸入，expression 為接收結果的變數名。 */
  'input',
  /** 場景結束。 */
  'end',
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** branch 節點的一條分支。條件成立即跳往 targetNodeId。 */
export const BranchSchema = z.object({
  id: UlidSchema,
  condition: ExpressionSchema,
  targetNodeId: UlidSchema.nullable().default(null),
  /** 來源表的 ID —— 分支在來源中各自是一列。 */
  sourceId: z.string().optional(),
  sourceJump: SourceJumpSchema.optional(),
  /** 同一組的分支可以標不同人物，因此說話者掛在分支上而非節點上。 */
  speaker: KeySchema.optional(),
  extras: ExtrasSchema.default({}),
});
export type Branch = z.infer<typeof BranchSchema>;

export const NodeSchema = z.object({
  id: UlidSchema,
  kind: NodeKindSchema.default('line'),
  /** 對應 Character.id；旁白留空。 */
  speaker: KeySchema.optional(),
  portrait: PortraitKeySchema.optional(),
  text: LocalizedTextSchema,
  /** 有選項時忽略 next。 */
  choices: z.array(ChoiceSchema).default([]),
  /** null 代表本場景結束。 */
  next: UlidSchema.nullable().default(null),
  /** 不成立時跳過本節點，直接前往 next。 */
  condition: ExpressionSchema.optional(),
  /** 進入節點時執行。 */
  actions: z.array(ActionSchema).default([]),
  audio: KeySchema.optional(),
  /** 給翻譯者的上下文備註，會匯出到 Excel 且可回寫。 */
  notes: z.string().default(''),
  /** branch / set / input 的運算式；line 節點不使用。 */
  expression: ExpressionSchema.optional(),
  /** kind 為 branch 時的分支清單，依序判斷。 */
  branches: z.array(BranchSchema).default([]),
  /**
   * 尚未有正式欄位的製作資訊，原樣保留。
   *
   * 匯入既有劇本時，來源表格往往帶著本工具還沒支援的欄位（OST、畫面效果、
   * 屬性變化…）。與其丟棄，不如原封不動地帶著走 —— 之後要正式支援哪一欄，
   * 資料都還在，也才能原樣匯出回去。
   */
  extras: ExtrasSchema.default({}),
  /** 來自來源劇本表的哪一列。編輯器新增的節點沒有這個欄位。 */
  source: SourceRowSchema.optional(),
  sourceJump: SourceJumpSchema.optional(),
});
export type StoryNode = z.infer<typeof NodeSchema>;

export const SceneSchema = z.object({
  id: UlidSchema,
  /** 場景名稱僅供編輯器與 Excel 顯示，不面向玩家，因此不做多語系。 */
  name: z.string(),
  entryNodeId: UlidSchema.nullable().default(null),
  nodes: z.array(NodeSchema).default([]),
  /**
   * 來源工作表的欄位順序。
   *
   * 各工作表的欄位並不一致（有的用「背景」有的用「場景」、有的是「選項解鎖」
   * 有的是「選項解鎖條件」），逐張記下來才能原樣寫回。
   */
  sourceColumns: z.array(z.string()).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

export const MetaSchema = z.object({
  formatVersion: z.string(),
  projectName: z.string().default(''),
  /** 至少一種語言；baseLanguage 必須在其中（由 validateStoryProject 檢查）。 */
  languages: z.array(LangCodeSchema).min(1),
  baseLanguage: LangCodeSchema,
  updatedAt: z.string().default(''),
  /** 工具列插入與序列化時使用的括號。解析器兩種都收。 */
  tagSyntax: TagSyntaxSchema.default('bracket'),
});
export type Meta = z.infer<typeof MetaSchema>;

/**
 * 上次匯出 Excel 時，所有可寫欄位的內容快照。
 *
 * 這是三方合併的 base：沒有它就無法分辨「Excel 改了」與「編輯器改了」，
 * 匯入只能變成整份覆蓋。key 格式見 keys.ts 的 fieldKey()。
 */
export const ExportSnapshotSchema = z.object({
  exportedAt: z.string(),
  /** fieldKey -> 匯出當下的字串內容。 */
  values: z.record(z.string(), z.string()),
});
export type ExportSnapshot = z.infer<typeof ExportSnapshotSchema>;

export const StoryProjectSchema = z.object({
  meta: MetaSchema,
  tagRegistry: TagRegistrySchema,
  variables: z.array(VariableSchema).default([]),
  characters: z.array(CharacterSchema).default([]),
  scenes: z.array(SceneSchema).default([]),
  exportSnapshot: ExportSnapshotSchema.nullable().default(null),
});
export type StoryProject = z.infer<typeof StoryProjectSchema>;
