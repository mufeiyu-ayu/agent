import type { LLMError } from '@agent/ai'
import {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from '@agent/ai'
import { LlmProxyError } from '../../llm/llm.errors.js'

/**
 * LLMError 的用户可见文案：普通 HTTP 接口（AllExceptionsFilter）与对话流的 error 事件共用一套，
 * 不带厂商名、状态码与上游 body；真实原因只进服务端日志。出站代理的失败例外，见下。
 */
export function getAiExceptionMessage(exception: LLMError): string {
  if (exception instanceof LLMAuthError) {
    return 'AI 服务认证失败，请检查服务端模型配置'
  }

  if (exception instanceof LLMBalanceError) {
    return 'AI 服务账户余额不足，请检查模型平台账户状态'
  }

  if (exception instanceof LLMRateLimitError) {
    return 'AI 服务请求过于频繁，请稍后重试'
  }

  if (exception instanceof LLMInvalidRequestError) {
    return 'AI 服务请求参数异常，请稍后重试'
  }

  // 代理未配置 / 代理连不上是本机网络配置问题，文案只含代理的 协议://主机:端口，原样给出才能定位。
  if (exception instanceof LlmProxyError) {
    return exception.message
  }

  if (exception instanceof LLMNetworkError) {
    return 'AI 服务暂时不可用，请稍后重试'
  }

  if (exception instanceof LLMServerError) {
    return 'AI 服务繁忙，请稍后重试'
  }

  if (exception instanceof LLMApiError) {
    return 'AI 服务返回异常，请稍后重试'
  }

  return 'AI 服务异常，请稍后重试'
}
