import { LLMNetworkError } from '@agent/ai'

/** 请求指定（或默认）的模型行当前不能用：不存在、前台不可见、所属 Provider 已停用，或密钥无法解密。 */
export class LlmModelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmModelUnavailableError'
  }
}

/**
 * 经出站代理访问时的网络失败：勾选了「使用代理」但本机没配 `OUTBOUND_PROXY_URL`，或代理本身连不上 / 转发失败。
 * 仍按 `llm_network` 归类；文案只带代理的 `协议://主机:端口`，不带凭据，Run Trace 与探活结果直接显示它。
 */
export class LlmProxyError extends LLMNetworkError {
  constructor(message: string, cause?: unknown) {
    super(cause ?? message)
    this.name = 'LlmProxyError'
    this.message = message
  }
}
