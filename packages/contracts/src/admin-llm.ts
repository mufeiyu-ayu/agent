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
 * 一个家族在 Chat Completions 之上的协议差异；所有流量都走中转站或直连的同一套 wire 协议，
 * 差异只写在这张表里，不按家族各写一个 adapter。对照 Pi 的 `OpenAICompletionsCompat`。
 * - `thinkingFormat`：请求体的思考开关。`'deepseek'` 发 `thinking: { type: 'enabled' }`；null 不发。
 * - `requiresReasoningContent`：Tool Call 必须回 `reasoning_content`（DeepSeek thinking 续轮回填需要）；
 *   中转站后面的 gpt / grok / gemini 只回 `reasoning_tokens` 不回正文，不能要求。
 * - `toolCallIndexOptional`：流式 tool_calls 分片可以不带 `index`，每个这样的分片就是一个完整调用，按出现顺序编号。
 * - `toolCallsMayFinishWithStop`：带 Tool Call 时 `finish_reason` 可能是 `stop`，按 `tool_calls` 处理。
 *   后两条来自 Google 官方 OpenAI 兼容端点的真实流（#157 fixture `gemini-direct.tool-call.sse`），其余家族保持严格。
 *   它们只让首轮 Tool Call 能被解析；直连 Google 的 Gemini 3 续轮还要回传 `extra_content.google.thought_signature`，
 *   当前不保存也不回填，工具循环在第二次请求会 400（证据见 #157 评论）。
 */
export interface LlmFamilyCompat {
  thinkingFormat: 'deepseek' | null
  requiresReasoningContent: boolean
  toolCallIndexOptional: boolean
  toolCallsMayFinishWithStop: boolean
}

/**
 * 各家族的协议事实，只此一处：compat 字段见 `LlmFamilyCompat`；
 * `reasoningEfforts` 是 `reasoning_effort` 可取值，按官方文档，空数组表示该家族不认这个参数。
 * 模型行默认值与请求级覆盖都只能取所属家族的值。中转站会把参数透传给上游，直连官方时同一张表照用。
 */
export const LLM_FAMILY_CAPABILITIES = {
  deepseek: { thinkingFormat: 'deepseek', requiresReasoningContent: true, toolCallIndexOptional: false, toolCallsMayFinishWithStop: false, reasoningEfforts: ['low', 'high', 'max'] },
  openai: { thinkingFormat: null, requiresReasoningContent: false, toolCallIndexOptional: false, toolCallsMayFinishWithStop: false, reasoningEfforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  grok: { thinkingFormat: null, requiresReasoningContent: false, toolCallIndexOptional: false, toolCallsMayFinishWithStop: false, reasoningEfforts: ['low', 'high'] },
  // Google 官方支持 low / medium / high，但中转站的 Gemini 已把档位写进模型名，且不回推理 token 无法验证透传；直连官方时再放开。
  gemini: { thinkingFormat: null, requiresReasoningContent: false, toolCallIndexOptional: true, toolCallsMayFinishWithStop: true, reasoningEfforts: [] },
  claude: { thinkingFormat: null, requiresReasoningContent: false, toolCallIndexOptional: false, toolCallsMayFinishWithStop: false, reasoningEfforts: ['low', 'medium', 'high'] },
  other: { thinkingFormat: null, requiresReasoningContent: false, toolCallIndexOptional: false, toolCallsMayFinishWithStop: false, reasoningEfforts: [] },
} as const satisfies Record<LlmProviderFamily, LlmFamilyCompat & { reasoningEfforts: readonly string[] }>

export type ReasoningEffort = typeof LLM_FAMILY_CAPABILITIES[LlmProviderFamily]['reasoningEfforts'][number]

/** 全部家族取值的并集：DTO 先做形状校验，家族归属在 service 里再查。 */
export const REASONING_EFFORTS: readonly ReasoningEffort[] = [...new Set(
  Object.values(LLM_FAMILY_CAPABILITIES).flatMap(item => item.reasoningEfforts as readonly ReasoningEffort[]),
)]

/** 数据库里的 family 是自由字符串，不认识的家族按 `other` 处理：不发 thinking、不要求 reasoning_content、不支持强度。 */
function capabilitiesOf(family: string) {
  return (LLM_FAMILY_CAPABILITIES as Record<string, typeof LLM_FAMILY_CAPABILITIES[LlmProviderFamily] | undefined>)[family]
    ?? LLM_FAMILY_CAPABILITIES.other
}

export function reasoningEffortsOf(family: string): readonly ReasoningEffort[] {
  return capabilitiesOf(family).reasoningEfforts
}

export function familyCompatOf(family: string): LlmFamilyCompat {
  const { thinkingFormat, requiresReasoningContent, toolCallIndexOptional, toolCallsMayFinishWithStop } = capabilitiesOf(family)

  return { thinkingFormat, requiresReasoningContent, toolCallIndexOptional, toolCallsMayFinishWithStop }
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
