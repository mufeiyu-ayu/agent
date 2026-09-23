/**
 * LLM 错误基类。
 * 所有 LLM 相关错误都继承此类，方便上层统一 catch。
 *
 * 状态码含义各家 OpenAI-compatible 端点一致，对照 DeepSeek 文档：
 * https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
 *
 * | HTTP | 含义 |
 * |------|------|
 * | 400  | 请求格式错误（中转站的 `upstream_error` 除外，按 5xx 归类） |
 * | 401  | API Key 认证失败 |
 * | 402  | 账户余额不足 |
 * | 403  | API Key 无权访问 |
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

/** 401 / 403：API Key 无效、过期、未配置，或无权使用该模型；文案带实际状态码 */
export class LLMAuthError extends LLMError {
  constructor(statusCode = 401, detail?: unknown) {
    const desc = statusCode === 403 ? 'API Key 无权访问' : 'API Key 认证失败'

    super(`${desc}（${statusCode}），请在后台检查该服务商的密钥是否正确、处于启用状态且有权使用该模型`, detail)
    this.name = 'LLMAuthError'
  }
}

/** 402：账户余额不足 */
export class LLMBalanceError extends LLMError {
  constructor(detail?: unknown) {
    super('账户余额不足（402），请到服务商控制台充值后重试', detail)
    this.name = 'LLMBalanceError'
  }
}

/** 429：请求速率（TPM/RPM）达到上限 */
export class LLMRateLimitError extends LLMError {
  constructor(detail?: unknown) {
    super('请求频率超限（429），当前账户 TPM/RPM 已达上限，请稍后重试或申请扩容', detail)
    this.name = 'LLMRateLimitError'
  }
}

/**
 * 5xx，以及中转站把上游故障包成的 400 `upstream_error`：服务端错误（503 为繁忙，其余按内部错误描述）。
 * `upstream` 是已脱敏、截断的上游错误摘要，只进 message 供服务端日志与管理台「测试模型」定位，不进用户文案。
 */
export class LLMServerError extends LLMError {
  constructor(statusCode: number, detail?: unknown, upstream = '') {
    const desc = statusCode === 503 ? '服务器繁忙' : '服务器内部错误'

    super(`服务商${desc}（${statusCode}），请稍后重试。如持续出现请检查服务商状态${upstream ? `: ${upstream}` : ''}`, detail)
    this.name = 'LLMServerError'
  }
}

/** 400 或 422：请求格式/参数错误；`upstream` 同 LLMServerError。 */
export class LLMInvalidRequestError extends LLMError {
  constructor(statusCode: number, detail?: unknown, upstream = '') {
    const desc = statusCode === 400 ? '请求格式错误' : '请求参数错误'

    super(`${desc}（${statusCode}），请根据错误提示修改请求体${upstream ? `: ${upstream}` : ''}`, detail)
    this.name = 'LLMInvalidRequestError'
  }
}

/** 环境变量缺失或配置格式不符合当前模型适配层要求 */
export class LLMConfigError extends LLMInvalidRequestError {
  constructor(configName: string, reason = '必须提供有效值') {
    const message = `LLM 配置 ${configName} 无效：${reason}`

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
