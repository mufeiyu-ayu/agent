import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
  DeepSeekBalanceResponse,
  DeepSeekModelsResponse,
} from '../llm.types.js'
import type { ModelStreamEvent } from '../model-stream.types.js'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import OpenAI, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from 'openai'

import {
  DEFAULT_CHAT_MAX_TOKENS,
  DEFAULT_CHAT_TEMPERATURE,
  LLM_REQUEST_TIMEOUT_MS,
  LLM_STREAM_TIMEOUT_MS,
} from '../llm.constants.js'
import {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMConfigError,
  LLMError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from '../llm.errors.js'
import { adaptOpenAICompatibleStream } from './openai-compatible-stream.adapter.js'

type ChatCompletionBaseParams = Pick<
  ChatCompletionCreateParamsNonStreaming,
  'messages' | 'model' | 'temperature' | 'max_tokens' | 'response_format'
>

interface LLMRuntimeConfig {
  apiKey: string
  baseUrl: string
}

/**
 * OpenAI-compatible 模型适配层。
 *
 * SDK、DeepSeek 兼容细节和错误转换都收敛在这里；业务层只依赖本项目自己的 LLM 类型。
 */
@Injectable()
export class OpenAICompatibleClient {
  async listModels(): Promise<DeepSeekModelsResponse> {
    return await this.runWithLLMErrorHandling(() =>
      this.createClient().get<DeepSeekModelsResponse>('/models', {
        timeout: LLM_REQUEST_TIMEOUT_MS,
      }),
    )
  }

  async getUserBalance(): Promise<DeepSeekBalanceResponse> {
    return await this.runWithLLMErrorHandling(() =>
      this.createClient().get<DeepSeekBalanceResponse>('/user/balance', {
        timeout: LLM_REQUEST_TIMEOUT_MS,
      }),
    )
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return await this.runWithLLMErrorHandling(async () => {
      const completion = await this.createClient().chat.completions.create(
        this.buildBaseChatCompletionParams(messages, options),
        {
          timeout: LLM_REQUEST_TIMEOUT_MS,
        },
      )
      const content = completion.choices[0]?.message.content

      if (typeof content !== 'string') {
        throw new LLMApiError(
          '模型未返回有效内容（choices[0].message.content 为空），请检查 messages 或换用模型重试',
          completion,
        )
      }

      return content
    })
  }

  async* chatStream(
    messages: ChatMessage[],
    options?: ChatStreamOptions,
  ): AsyncGenerator<ModelStreamEvent> {
    const client = this.createClient()
    const requestOptions = {
      timeout: LLM_STREAM_TIMEOUT_MS,
      ...(options?.signal ? { signal: options.signal } : {}),
    }

    try {
      const stream = await client.chat.completions.create(
        {
          ...this.buildBaseChatCompletionParams(messages, options),
          stream: true,
          stream_options: {
            include_usage: true,
          },
        },
        requestOptions,
      )

      yield* adaptOpenAICompatibleStream(stream)
    }
    catch (cause) {
      throw this.toLLMError(cause)
    }
  }

  private createClient(): OpenAI {
    const { apiKey, baseUrl } = this.getRuntimeConfig()

    return new OpenAI({
      apiKey,
      baseURL: baseUrl,
      maxRetries: 0,
    })
  }

  private getRuntimeConfig(): LLMRuntimeConfig {
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

  private getModel(options?: ChatOptions): string {
    const model = (options?.model ?? process.env.LLM_MODEL)?.trim()

    if (!model) {
      throw new LLMConfigError('LLM_MODEL')
    }

    return model
  }

  private buildBaseChatCompletionParams(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): ChatCompletionBaseParams {
    const params: ChatCompletionBaseParams = {
      model: this.getModel(options),
      messages: messages.map(toOpenAIChatMessage),
      temperature: options?.temperature ?? DEFAULT_CHAT_TEMPERATURE,
      max_tokens: options?.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
    }

    if (options?.responseFormat) {
      params.response_format = options.responseFormat
    }

    return params
  }

  private async runWithLLMErrorHandling<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    }
    catch (cause) {
      throw this.toLLMError(cause)
    }
  }

  private toLLMError(cause: unknown): LLMError {
    if (cause instanceof LLMError)
      return cause

    if (cause instanceof APIUserAbortError || cause instanceof APIConnectionError)
      return new LLMNetworkError(cause)

    if (cause instanceof APIError)
      return this.toLLMHttpError(cause)

    return new LLMNetworkError(cause)
  }

  private toLLMHttpError(error: APIError): LLMError {
    switch (error.status) {
      case 400:
        return new LLMInvalidRequestError(400, error)
      case 401:
      case 403:
        return new LLMAuthError(undefined, error)
      case 402:
        return new LLMBalanceError(error)
      case 422:
        return new LLMInvalidRequestError(422, error)
      case 429:
        return new LLMRateLimitError(error)
      case 500:
      case 503:
        return new LLMServerError(error.status, error)
      default:
        return new LLMApiError(
          this.formatUnhandledApiErrorMessage(error),
          error,
        )
    }
  }

  private formatUnhandledApiErrorMessage(error: APIError): string {
    const status = error.status ? `HTTP ${error.status}` : '未知 HTTP 状态'
    const message = error.message ? `: ${error.message}` : ''

    return `LLM API ${status} 错误${message}`
  }
}

function toOpenAIChatMessage(message: ChatMessage): ChatCompletionMessageParam {
  return {
    role: message.role,
    content: message.content,
  }
}
