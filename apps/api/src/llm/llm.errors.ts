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

/** 网络连接失败 / DNS 解析失败 / 请求超时（非模型业务错误） */
export class LLMNetworkError extends LLMError {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)

    super(`LLM API 网络请求失败: ${message}`, cause)
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

/** 环境变量缺失或配置格式不符合当前模型适配层要求 */
export class LLMConfigError extends LLMInvalidRequestError {
  constructor(configName: 'LLM_BASE_URL' | 'LLM_MODEL') {
    const message = `请在项目根目录 .env 中设置 ${configName}`

    super(400, { configName, message })
    this.name = 'LLMConfigError'
    this.message = message
  }
}

/** API 返回异常、SDK 解析失败，或 LLMService 内部解析失败 */
export class LLMApiError extends LLMError {
  constructor(message: string, detail?: unknown) {
    super(message, detail)
    this.name = 'LLMApiError'
  }
}
