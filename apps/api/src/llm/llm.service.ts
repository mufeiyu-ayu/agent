import type { ChatMessage, ChatOptions, DeepSeekErrorDetail, OpenAIChatResponse } from './llm.types.js'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from './llm.types.js'

/**
 * 封装对 DeepSeek / OpenAI-compatible Chat Completions API 的 fetch 调用。
 *
 * 错误码对照（DeepSeek 官方文档）：
 * | 400 | 请求格式错误         | LLMInvalidRequestError  |
 * | 401 | API Key 认证失败     | LLMAuthError            |
 * | 402 | 账户余额不足         | LLMBalanceError         |
 * | 422 | 请求参数错误         | LLMInvalidRequestError  |
 * | 429 | 请求速率达到上限     | LLMRateLimitError       |
 * | 500 | 服务器内部错误       | LLMServerError          |
 * | 503 | 服务器繁忙           | LLMServerError          |
 *
 * 未覆盖的 4xx/5xx 状态码由 LLMApiError 兜底。
 */
@Injectable()
export class LLMService {
  /**
   * 发送一次 chat 请求，返回模型回复的纯文本（choices[0].message.content）。
   *
   * @param messages  - 消息数组（system / user / assistant）
   * @param options   - 可选：覆盖 model、temperature、maxTokens、responseFormat
   * @returns 模型回复的字符串内容
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const apiKey = process.env.LLM_API_KEY
    const baseUrl = process.env.LLM_BASE_URL

    if (!apiKey) {
      throw new LLMAuthError('请在 apps/api/.env 中设置 LLM_API_KEY')
    }
    if (!baseUrl) {
      throw new LLMAuthError('请在 apps/api/.env 中设置 LLM_BASE_URL')
    }

    const body = JSON.stringify({
      model: options?.model ?? process.env.LLM_MODEL,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
    })

    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      })
    }
    catch (cause) {
      throw new LLMNetworkError(cause)
    }

    // 解析 error body（用于错误定位），所有非 2xx 都可能携带 DeepSeek error 结构
    let errorBody: DeepSeekErrorDetail | undefined
    if (!response.ok) {
      try {
        errorBody = (await response.json()) as DeepSeekErrorDetail
      }
      catch {
        // body 无法解析时忽略，以 HTTP 状态码为准
      }
    }

    // ─── 按 DeepSeek 官方错误码逐类处理 ───────
    if (!response.ok) {
      const apiMessage = errorBody?.error?.message

      switch (response.status) {
        case 400:
          throw new LLMInvalidRequestError(400, errorBody)
        case 401:
          throw new LLMAuthError(undefined, errorBody)
        case 402:
          throw new LLMBalanceError(errorBody)
        case 422:
          throw new LLMInvalidRequestError(422, errorBody)
        case 429:
          throw new LLMRateLimitError(errorBody)
        case 500:
        case 503:
          throw new LLMServerError(response.status, errorBody)
        default:
          throw new LLMApiError(
            apiMessage
              ? `HTTP ${response.status}: ${apiMessage}`
              : `LLM API HTTP ${response.status} 错误，请稍后重试`,
            errorBody ?? response.status,
          )
      }
    }

    const data = (await response.json()) as OpenAIChatResponse

    // 2xx 但 body 仍可能包含 error（如 API 层面的逻辑错误）
    if (data.error) {
      throw new LLMApiError(
        `API 返回错误: ${data.error.message}`,
        data.error,
      )
    }

    const content = data.choices?.[0]?.message?.content
    if (content === undefined) {
      throw new LLMApiError(
        '模型未返回有效内容（choices[0].message.content 为空），请检查 messages 或换用模型重试',
        data,
      )
    }

    return content
  }
}
