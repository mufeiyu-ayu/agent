/**
 * LLM 调用相关类型定义
 *
 * 职责边界：
 * - 只定义 LLM HTTP 层的类型（消息结构、请求选项、API 响应结构）
 * - 不包含任何 SEO 业务字段（title、description 等由上层定义）
 */

// ─── 消息结构 ────────────────────────────────

/** 标准 chat message */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─── 请求选项 ────────────────────────────────

/** chat() 方法的可选参数，会覆盖环境变量中的默认值 */
export interface ChatOptions {
  /** 模型名，默认从 LLM_MODEL 环境变量读取 */
  model?: string
  /** 生成温度 0-2，默认 0.7 */
  temperature?: number
  /** 最大输出 token 数，默认 2048 */
  maxTokens?: number
  /** JSON 输出约束（对应 OpenAI response_format） */
  responseFormat?: { type: 'json_object' } | { type: 'text' }
}

// ─── OpenAI 兼容 API 响应结构 ─────────────────

interface OpenAIChoice {
  index: number
  message: {
    role: string
    content: string
  }
  finish_reason: string
}

interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface OpenAIChatResponse {
  id: string
  object: string
  created: number
  model: string
  choices: OpenAIChoice[]
  usage?: OpenAIUsage
  error?: {
    message: string
    type: string
    code?: string
  }
}

// ─── DeepSeek / OpenAI 错误响应结构 ────────────

/**
 * DeepSeek API 错误响应的 body 结构。
 * 参考：https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
 */
export interface DeepSeekErrorDetail {
  error: {
    code: string
    message: string
    param: string | null
    type: string
  }
}

// ─── 错误类型 ────────────────────────────────

/**
 * LLM 错误基类。
 * 所有 LLM 相关错误都继承此类，方便上层统一 catch。
 *
 * 官方错误码对照：
 * https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
 *
 * | HTTP | 含义 |
 * |------|------|
 * | 400  | 请求格式错误 |
 * | 401  | API Key 认证失败 |
 * | 402  | 账户余额不足 |
 * | 422  | 请求参数错误 |
 * | 429  | 请求速率达到上限 |
 * | 500  | 服务器内部错误 |
 * | 503  | 服务器繁忙 |
 */
export class LLMError extends Error {
  constructor(
    message: string,
    /** 原始 error body / 异常对象，用于后端日志定位 */
    public readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'LLMError'
  }
}

/** 网络连接失败 / DNS 解析失败 / 请求超时（fetch 自身异常，非 HTTP 错误） */
export class LLMNetworkError extends LLMError {
  constructor(cause: unknown) {
    super(`LLM API 网络请求失败: ${String(cause)}`, cause)
    this.name = 'LLMNetworkError'
  }
}

/** 401：API Key 无效、过期或未配置 */
export class LLMAuthError extends LLMError {
  constructor(hint?: string, detail?: unknown) {
    const base = 'DeepSeek API Key 认证失败（401），请检查 LLM_API_KEY 是否正确且处于启用状态'
    super(hint ? `${base}。${hint}` : base, detail)
    this.name = 'LLMAuthError'
  }
}

/** 402：账户余额不足 */
export class LLMBalanceError extends LLMError {
  constructor(detail?: unknown) {
    super('DeepSeek 账户余额不足（402），请前往 platform.deepseek.com 充值后重试', detail)
    this.name = 'LLMBalanceError'
  }
}

/** 429：请求速率（TPM/RPM）达到上限 */
export class LLMRateLimitError extends LLMError {
  constructor(detail?: unknown) {
    super('DeepSeek 请求频率超限（429），当前账户 TPM/RPM 已达上限，请稍后重试或申请扩容', detail)
    this.name = 'LLMRateLimitError'
  }
}

/** 500 或 503：服务端错误 */
export class LLMServerError extends LLMError {
  constructor(statusCode: number, detail?: unknown) {
    const desc = statusCode === 503 ? '服务器繁忙' : '服务器内部错误'
    super(`DeepSeek ${desc}（${statusCode}），请稍后重试。如持续出现请检查 DeepSeek 服务状态`, detail)
    this.name = 'LLMServerError'
  }
}

/** 400 或 422：请求格式/参数错误 */
export class LLMInvalidRequestError extends LLMError {
  constructor(statusCode: number, detail?: unknown) {
    const desc = statusCode === 400 ? '请求格式错误' : '请求参数错误'
    super(`DeepSeek ${desc}（${statusCode}），请根据错误提示修改请求体`, detail)
    this.name = 'LLMInvalidRequestError'
  }
}

/** API 返回 2xx 但 body 中包含 error 字段，或 LLMService 内部解析失败 */
export class LLMApiError extends LLMError {
  constructor(message: string, detail?: unknown) {
    super(message, detail)
    this.name = 'LLMApiError'
  }
}
