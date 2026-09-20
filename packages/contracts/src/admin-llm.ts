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
 * 各家族的协议事实，只此一处：
 * - `thinking`：是否走 DeepSeek thinking 协议（请求带 `thinking`，Tool Call 要求 `reasoning_content`）。
 * - `reasoningEfforts`：`reasoning_effort` 可取值，按官方文档；空数组表示该家族不认这个参数。
 * 模型行默认值与请求级覆盖都只能取所属家族的值。中转站会把参数透传给上游，直连官方时同一张表照用。
 */
export const LLM_FAMILY_CAPABILITIES = {
  deepseek: { thinking: true, reasoningEfforts: ['low', 'high', 'max'] },
  openai: { thinking: false, reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  grok: { thinking: false, reasoningEfforts: ['low', 'high'] },
  // Google 官方支持 low / medium / high，但中转站的 Gemini 已把档位写进模型名，且不回推理 token 无法验证透传；直连官方时再放开。
  gemini: { thinking: false, reasoningEfforts: [] },
  claude: { thinking: false, reasoningEfforts: ['low', 'medium', 'high'] },
  other: { thinking: false, reasoningEfforts: [] },
} as const satisfies Record<LlmProviderFamily, { thinking: boolean, reasoningEfforts: readonly string[] }>

export type ReasoningEffort = typeof LLM_FAMILY_CAPABILITIES[LlmProviderFamily]['reasoningEfforts'][number]

/** 全部家族取值的并集：DTO 先做形状校验，家族归属在 service 里再查。 */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [...new Set(
  Object.values(LLM_FAMILY_CAPABILITIES).flatMap(item => item.reasoningEfforts as readonly ReasoningEffort[]),
)]

/** 数据库里的 family 是自由字符串，不认识的家族按「不走 thinking、不支持强度」处理。 */
function capabilitiesOf(family: string) {
  return (LLM_FAMILY_CAPABILITIES as Record<string, typeof LLM_FAMILY_CAPABILITIES[LlmProviderFamily] | undefined>)[family]
}

export function reasoningEffortsOf(family: string): readonly ReasoningEffort[] {
  return capabilitiesOf(family)?.reasoningEfforts ?? []
}

export function isThinkingFamily(family: string): boolean {
  return capabilitiesOf(family)?.thinking ?? false
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

/**
 * 拉模型清单 / 测模型用的凭据，不落库：给了 apiKey 就用它（新增或换密钥）；
 * 否则按 providerId 用库里的密钥，baseUrl 用表单里当前的值（可以还没保存）。
 */
export interface AdminLlmCredentialsInput {
  providerId?: string
  baseUrl: string
  apiKey?: string
}

/** 对勾选的模型各发一条最短对话请求，验证对话接口真的通。 */
export interface AdminLlmTestModelsRequest extends AdminLlmCredentialsInput {
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
