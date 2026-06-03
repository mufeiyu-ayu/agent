import type { ChatMessage, ChatOptions, DeepSeekBalanceResponse, DeepSeekErrorDetail, DeepSeekModelsResponse, OpenAIChatResponse } from './llm.types.js'
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

const LLM_REQUEST_TIMEOUT_MS = 10000

class LLMConfigError extends LLMInvalidRequestError {
  constructor(configName: 'LLM_BASE_URL' | 'LLM_MODEL') {
    const message = `请在项目根目录 .env 中设置 ${configName}`

    super(400, { configName, message })
    this.name = 'LLMConfigError'
    this.message = message
  }
}

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
  async listModels(): Promise<DeepSeekModelsResponse> {
    return this.requestDeepSeek<DeepSeekModelsResponse>('/models')
  }

  async getUserBalance(): Promise<DeepSeekBalanceResponse> {
    return this.requestDeepSeek<DeepSeekBalanceResponse>('/user/balance')
  }

  /**
   * 发送一次 chat 请求，返回模型回复的纯文本（choices[0].message.content）。
   *
   * @param messages  - 消息数组（system / user / assistant）
   * @param options   - 可选：覆盖 model、temperature、maxTokens、responseFormat
   * @returns 模型回复的字符串内容
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const model = (options?.model ?? process.env.LLM_MODEL)?.trim()

    if (!model) {
      throw new LLMConfigError('LLM_MODEL')
    }

    const body = JSON.stringify({
      model,
      messages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
      ...(options?.responseFormat ? { response_format: options.responseFormat } : {}),
    })

    const data = await this.requestDeepSeek<OpenAIChatResponse>('/chat/completions', {
      method: 'POST',
      body,
    })

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

  private getRuntimeConfig() {
    const apiKey = process.env.LLM_API_KEY?.trim()
    const baseUrl = process.env.LLM_BASE_URL?.trim()

    if (!apiKey) {
      throw new LLMAuthError('请在项目根目录 .env 中设置 LLM_API_KEY')
    }
    if (!baseUrl) {
      throw new LLMConfigError('LLM_BASE_URL')
    }

    return {
      apiKey,
      baseUrl: baseUrl.replace(/\/+$/, ''),
    }
  }

  private async requestDeepSeek<T>(path: string, init?: RequestInit): Promise<T> {
    const { apiKey, baseUrl } = this.getRuntimeConfig()
    const response = await this.fetchDeepSeek(`${baseUrl}${path}`, apiKey, init)

    await this.handleDeepSeekHttpError(response)

    try {
      return await response.json() as T
    }
    catch (cause) {
      throw new LLMApiError('LLM API 返回内容不是合法 JSON，请稍后重试', cause)
    }
  }

  private async fetchDeepSeek(url: string, apiKey: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers)

    headers.set('Authorization', `Bearer ${apiKey}`)
    headers.set('Content-Type', 'application/json')

    try {
      return await fetch(url, {
        ...init,
        method: init?.method ?? 'GET',
        signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
        headers,
      })
    }
    catch (cause) {
      throw new LLMNetworkError(cause)
    }
  }

  private async handleDeepSeekHttpError(response: Response): Promise<void> {
    if (response.ok)
      return

    let errorBody: DeepSeekErrorDetail | undefined
    try {
      errorBody = await response.json() as DeepSeekErrorDetail
    }
    catch {
      // body 无法解析时忽略，以 HTTP 状态码为准
    }

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
}
