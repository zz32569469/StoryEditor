import { z } from 'zod';
import { KeySchema } from './ids';

/**
 * 特效標籤登錄表（tagRegistry）。
 *
 * 這份資料是網頁預覽端與 Unity runtime 端「共用的單一真實來源」：
 * 兩端各自實作渲染，但可用的標籤名稱、參數與預設值以此為準。
 *
 * 標籤採「內嵌文字標記」而非區間資料結構，因為標記必須能原封不動地
 * 塞進 Excel 的一個儲存格來回搬運。
 */

/**
 * 標記用哪一種括號。
 *
 * 解析器**兩種都收**，這個設定只決定編輯器的工具列插入哪一種、
 * 以及序列化時寫出哪一種。既有劇本各有慣例，工具遷就資料而不是相反。
 */
export const TagSyntaxSchema = z.enum(['bracket', 'brace']);
export type TagSyntax = z.infer<typeof TagSyntaxSchema>;

export const TagParamTypeSchema = z.enum(['number', 'string', 'color', 'boolean']);
export type TagParamType = z.infer<typeof TagParamTypeSchema>;

export const TagParamDefSchema = z.object({
  /** 參數名稱，對應 `[shake amp=3]` 中的 `amp`。 */
  name: KeySchema,
  type: TagParamTypeSchema,
  /** 省略時採用的預設值。 */
  default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  description: z.string().default(''),
});
export type TagParamDef = z.infer<typeof TagParamDefSchema>;

export const TagKindSchema = z.enum([
  /** 成對標籤，作用於一段文字：`[shake]內容[/shake]`。 */
  'paired',
  /** 單點標籤，作用於插入位置：`[wait=0.5]`。 */
  'inline',
]);
export type TagKind = z.infer<typeof TagKindSchema>;

export const TagDefSchema = z.object({
  name: KeySchema,
  kind: TagKindSchema,
  /**
   * 位置參數：允許 `[color=#ff0000]` 這種簡寫，值會指派給這裡指定的參數名。
   * 未設定時，該標籤只能用具名參數形式 `[shake amp=3]`。
   */
  positional: KeySchema.optional(),
  params: z.array(TagParamDefSchema).default([]),
  description: z.string().default(''),
});
export type TagDef = z.infer<typeof TagDefSchema>;

export const TagRegistrySchema = z.array(TagDefSchema);
export type TagRegistry = z.infer<typeof TagRegistrySchema>;

/**
 * 預設標籤集。專案可以增刪，但這幾個是兩端 runtime 都預期會實作的基礎集合。
 *
 * `size` 用「倍率」而非絕對點數，`font` 用「代號」而非字型檔名 ——
 * 兩者都是為了讓同一份文字在網頁 CSS 與 Unity TMP 上都能對應得上。
 */
export const DEFAULT_TAG_REGISTRY: TagRegistry = [
  { name: 'b', kind: 'paired', params: [], description: '粗體' },
  { name: 'i', kind: 'paired', params: [], description: '斜體' },
  {
    name: 'color',
    kind: 'paired',
    positional: 'value',
    params: [{ name: 'value', type: 'color', description: '十六進位色碼，例 #ff3333' }],
    description: '文字顏色',
  },
  {
    name: 'size',
    kind: 'paired',
    positional: 'value',
    params: [{ name: 'value', type: 'number', default: 1.5, description: '相對於基準字級的倍率' }],
    description: '文字大小（倍率）',
  },
  {
    name: 'font',
    kind: 'paired',
    positional: 'value',
    params: [{ name: 'value', type: 'string', description: '字型代號，兩端各自對應到實際字型資產' }],
    description: '切換字型',
  },
  {
    name: 'shake',
    kind: 'paired',
    params: [
      { name: 'amp', type: 'number', default: 2, description: '振幅（像素／單位）' },
      { name: 'freq', type: 'number', default: 20, description: '頻率（每秒）' },
    ],
    description: '逐字抖動',
  },
  {
    name: 'wave',
    kind: 'paired',
    params: [
      { name: 'amp', type: 'number', default: 3, description: '振幅' },
      { name: 'freq', type: 'number', default: 2, description: '頻率（每秒）' },
    ],
    description: '波浪起伏',
  },
  {
    // 成對而非單點：作用範圍明確，也不會發生「改快之後忘記改回來」。
    name: 'speed',
    kind: 'paired',
    positional: 'value',
    params: [{ name: 'value', type: 'number', default: 0.5, description: '相對於基準速度的倍率，小於 1 為變慢' }],
    description: '逐字速度（作用於選取範圍）',
  },
  {
    name: 'wait',
    kind: 'inline',
    positional: 'value',
    params: [{ name: 'value', type: 'number', default: 0.3, description: '停頓秒數' }],
    description: '停頓',
  },
  {
    name: 'sfx',
    kind: 'inline',
    positional: 'value',
    params: [{ name: 'value', type: 'string', description: '音效代號' }],
    description: '播放音效',
  },
];
