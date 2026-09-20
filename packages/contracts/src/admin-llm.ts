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
  /** 是否走 DeepSeek thinking 路径（请求带 thinking / reasoning_effort，Tool Call 要求 reasoning_content）。 */
  reasoning: boolean
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
  reasoning: boolean
  visible: boolean
  isDefault: boolean
  sortOrder: number
}

export interface AdminLlmFetchModelsResponse {
  models: string[]
}

export interface AdminLlmImportModelsRequest {
  wireNames: string[]
}

export interface AdminLlmImportModelsResponse {
  imported: number
  skipped: number
}
