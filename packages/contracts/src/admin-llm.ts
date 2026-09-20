/**
 * Admin LLM 配置的读写契约（Issue #142）。
 * Provider 是一把 key + 一个 baseUrl；Model 挂在 Provider 下，前台只看到 visible 为真的行。
 */

/** 服务商就是模型家族：决定管理台标识与导入预设，不参与请求拼接。 */
export const LLM_PROVIDER_FAMILIES = [
  'deepseek',
  'openai',
  'grok',
  'gemini',
  'claude',
  'other',
] as const

export type LlmProviderFamily = typeof LLM_PROVIDER_FAMILIES[number]

/**
 * 各家族 `reasoning_effort` 的可取值，按官方文档（DeepSeek / OpenAI / xAI / Google / Anthropic）。
 * 空数组表示该家族不认这个参数；模型行默认值与请求级覆盖都只能取所属家族的值。
 * 中转站会把这个参数透传给上游，直连官方时同一张表照用；接入新家族只改这里。
 */
export const REASONING_EFFORTS_BY_FAMILY = {
  deepseek: ['low', 'high', 'max'],
  openai: ['minimal', 'low', 'medium', 'high', 'xhigh'],
  grok: ['low', 'high'],
  // Google 官方支持 low / medium / high，但中转站的 Gemini 已把档位写进模型名，且不回推理 token 无法验证透传；直连官方时再放开。
  gemini: [],
  claude: ['low', 'medium', 'high'],
  other: [],
} as const satisfies Record<LlmProviderFamily, readonly string[]>

export type ReasoningEffort = typeof REASONING_EFFORTS_BY_FAMILY[LlmProviderFamily][number]

/** 全部家族取值的并集：DTO 先做形状校验，家族归属在 service 里再查。 */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [...new Set(
  (Object.values(REASONING_EFFORTS_BY_FAMILY) as readonly (readonly ReasoningEffort[])[]).flat(),
)]

/** 数据库里的 family 是自由字符串，不认识的家族按不支持处理。 */
export function reasoningEffortsOf(family: string): readonly ReasoningEffort[] {
  return (REASONING_EFFORTS_BY_FAMILY as Record<string, readonly ReasoningEffort[] | undefined>)[family] ?? []
}

export interface AdminLlmProvider {
  id: string
  family: LlmProviderFamily
  /** 给人看的备注，例如「公司中转站」「官方」。 */
  note: string
  baseUrl: string
  /** 密钥只回显尾四位，完整 key 永不出现在任何响应里。 */
  apiKeyLast4: string
  enabled: boolean
  modelCount: number
  createdAt: string
  updatedAt: string
}

export interface AdminLlmProviderInput {
  family: LlmProviderFamily
  note: string
  baseUrl: string
  /** 新增时必填；更新时省略或空串表示不改。 */
  apiKey?: string
  enabled: boolean
  /** 新增时随服务商一起导入的模型名（来自预览拉取的勾选）；更新时忽略。 */
  importWireNames?: string[]
  /** 弹窗里对 importWireNames 已做过的测试结果，随行写入 lastProbe*；没测过的名字不用给。 */
  importTestResults?: AdminLlmModelTestResult[]
}

/** 存库前用填好的地址与密钥拉一次模型清单，用来验证配置；不落库。 */
export interface AdminLlmPreviewModelsRequest {
  baseUrl: string
  apiKey: string
}

/** 对勾选的模型各发一条最短对话请求，验证对话接口真的通；不落库。 */
export interface AdminLlmTestModelsRequest extends AdminLlmPreviewModelsRequest {
  wireNames: string[]
}

export interface AdminLlmModelTestResult {
  wireName: string
  ok: boolean
  /** 失败原因；成功为 null。 */
  error: string | null
}

export interface AdminLlmTestModelsResponse {
  results: AdminLlmModelTestResult[]
}

export interface AdminLlmModel {
  id: string
  providerId: string
  /** 发给服务商的模型名。 */
  wireName: string
  /** 前台显示名。 */
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  /** 默认发给服务商的 reasoning_effort；null 表示不发。 */
  reasoningEffort: ReasoningEffort | null
  visible: boolean
  isDefault: boolean
  sortOrder: number
  /** 上次「测试」结果：null 表示没测过。 */
  lastProbeOk: boolean | null
  lastProbeError: string | null
  lastProbedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 重测若干已入库的模型；结果写回各行。 */
export interface AdminLlmProbeModelsRequest {
  modelIds: string[]
}

export interface AdminLlmModelInput {
  wireName: string
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  reasoningEffort: ReasoningEffort | null
  visible: boolean
  isDefault: boolean
  sortOrder: number
}

export interface AdminLlmFetchModelsResponse {
  models: string[]
}

export interface AdminLlmImportModelsRequest {
  wireNames: string[]
  /** 弹窗里对 wireNames 已做过的测试结果，随行写入 lastProbe*；没测过的名字不用给。 */
  testResults?: AdminLlmModelTestResult[]
}

export interface AdminLlmImportModelsResponse {
  imported: number
  skipped: number
}
