import type { ReasoningEffort } from '@agent/contracts'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
import type { LLMClientConfig, ResolvedChatRequestConfig } from '../config.js'
import type {
  ProviderBalanceResponse,
  ProviderModelsResponse,
} from '../provider-metadata.js'
import type {
  ChatOptions,
  ChatStreamOptions,
  ModelInputItem,
  ModelIODebugCapture,
  ModelIODebugCaptureSide,
  ModelRawResponseCapture,
  ModelStreamEvent,
  ModelToolSpec,
} from '../types.js'
import OpenAI, {
  APIConnectionError,
  APIError,
  APIUserAbortError,
} from 'openai'

import {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from '../errors.js'
import { teeRawResponseCapture } from './openai-completions-raw-capture.js'
import { adaptOpenAICompatibleStream } from './openai-completions-stream.js'

/**
 * 显式传给 SDK 的每类请求超时，不依赖 SDK 默认值；没有部署差异需求前不做 env。
 * SDK timeout 只约束到首个响应头，且重试时每次尝试各自计时；Agent Loop 只走
 * `chatStream`，流正文阶段只受 `AGENT_RUN_DEADLINE_MS` 的 abort 约束；
 * 非流式 `chat` 的 60s 只适合短输出。
 */
const METADATA_REQUEST_TIMEOUT_MS = 10_000
const CHAT_REQUEST_TIMEOUT_MS = 60_000
const STREAM_TIMEOUT_MS = 600_000
/**
 * 交给 SDK 内置重试的瞬态失败次数（408 / 409 / 429 / 5xx、连接错误；退避与
 * `retry-after` 由 SDK 处理）。重试边界是首个响应头之前：流正文中断不重试，
 * 已推给调用方的 delta 无法撤回；abort 信号触发后也不再重试。
 * SDK 的退避 sleep 不监听 signal，且对 `retry-after` 不设上限，`chatStream`
 * 用 `rejectOnAbort` 让 abort 立即胜出，deadline / 用户停止不会被 sleep 拖住。
 */
const REQUEST_MAX_RETRIES = 2

type ChatCompletionBaseParams = Pick<
  ChatCompletionCreateParamsNonStreaming,
  'messages' | 'model' | 'max_tokens' | 'response_format'
> & {
  /** DeepSeek thinking 开关只对 reasoning 模型发。 */
  thinking?: { type: 'enabled' }
  /** 任何家族配置了就发，取值按家族见 contracts 的 REASONING_EFFORTS_BY_FAMILY。 */
  reasoning_effort?: ReasoningEffort
}

type AssistantToolCallMessageParam
  = ChatCompletionAssistantMessageParam & {
    reasoning_content?: string
  }

/**
 * OpenAI-compatible 模型适配层。
 *
 * SDK、DeepSeek 兼容细节和错误转换都收敛在这里；业务层只依赖本项目自己的 LLM 类型。
 * 一个实例对应一个 Provider（一把 key + 一个 baseUrl）；模型名与能力随每次请求传入。
 */
export class OpenAICompatibleClient {
  constructor(private readonly clientConfig: LLMClientConfig) {}

  async listModels(): Promise<ProviderModelsResponse> {
    return await this.runWithLLMErrorHandling(() =>
      this.createClient().get<ProviderModelsResponse>('/models', {
        timeout: METADATA_REQUEST_TIMEOUT_MS,
      }),
    )
  }

  /** DeepSeek 的余额端点在 origin 下（`/user/balance`），不在 `/v1` 前缀下；用绝对 URL 绕过 baseURL 拼接。 */
  async getUserBalance(): Promise<ProviderBalanceResponse> {
    const url = new URL('/user/balance', this.clientConfig.baseUrl).href

    return await this.runWithLLMErrorHandling(() =>
      this.createClient().get<ProviderBalanceResponse>(url, {
        timeout: METADATA_REQUEST_TIMEOUT_MS,
      }),
    )
  }

  async chat(messages: ModelInputItem[], options: ChatOptions): Promise<string> {
    return await this.runWithLLMErrorHandling(async () => {
      const completion = await this.createClient().chat.completions.create(
        this.buildBaseChatCompletionParams(
          messages.map(toOpenAIModelInputItem),
          options,
        ) as unknown as ChatCompletionCreateParamsNonStreaming,
        {
          timeout: CHAT_REQUEST_TIMEOUT_MS,
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
    messages: ModelInputItem[],
    options: ChatStreamOptions,
  ): AsyncGenerator<ModelStreamEvent> {
    const client = this.createClient()
    // SDK 每次尝试都在 signal 上挂 abort 监听且成功后不移除；一个 Run 的多轮采样
    // 共用同一个 run 级 signal，按尝试次数累积到 11 个就打 MaxListenersExceededWarning，
    // 派生一次性信号把监听隔离到本次调用。
    const signal = options.signal && AbortSignal.any([options.signal])
    const requestOptions = {
      timeout: STREAM_TIMEOUT_MS,
      ...(signal ? { signal } : {}),
    }
    // debug 捕获只在开关开启且调用方提供回调时生效；请求体不含 apiKey / baseUrl
    // 等凭据（它们只存在于 SDK client 配置里，不在请求 params 中）。
    const debugCapture = this.clientConfig.captureModelIO
      ? options.debugCapture
      : undefined
    let requestStarted = false
    let responseCaptureCommitted = false
    const notifyCaptureError = (side: ModelIODebugCaptureSide): void => {
      try {
        debugCapture?.onCaptureError?.(side)
      }
      catch {
        // debug 旁路连错误通知都不得改变模型调用。
      }
    }
    const commitResponseCapture = (capture: ModelRawResponseCapture): void => {
      if (!debugCapture || responseCaptureCommitted)
        return

      responseCaptureCommitted = true

      try {
        debugCapture.onResponse(capture)
      }
      catch {
        notifyCaptureError('response')
      }
    }

    try {
      const requestParams = {
        ...this.buildBaseChatCompletionParams(
          messages.map(toOpenAIModelInputItem),
          options,
        ),
        ...toOpenAIChatTools(options.tools),
        stream: true as const,
        stream_options: {
          include_usage: true,
        },
      }

      safelyCaptureRequest(debugCapture, requestParams, notifyCaptureError)

      requestStarted = true
      const stream = await rejectOnAbort(
        client.chat.completions.create(
          requestParams as unknown as ChatCompletionCreateParamsStreaming,
          requestOptions,
        ),
        signal,
      )

      yield* adaptOpenAICompatibleStream(
        debugCapture
          ? teeRawResponseCapture(
              stream,
              commitResponseCapture,
              () => notifyCaptureError('response'),
            )
          : stream,
        { requireReasoningContent: options.request.reasoning },
      )
    }
    catch (cause) {
      if (requestStarted && debugCapture && !responseCaptureCommitted) {
        commitResponseCapture({
          state: 'empty',
          lastEvent: null,
          textChars: 0,
          toolCallCount: 0,
        })
      }
      throw this.toLLMError(cause)
    }
  }

  private createClient(): OpenAI {
    const { apiKey, baseUrl } = this.clientConfig

    return new OpenAI({
      apiKey,
      baseURL: baseUrl,
      maxRetries: REQUEST_MAX_RETRIES,
    })
  }

  private buildBaseChatCompletionParams(
    messages: ChatCompletionMessageParam[],
    options: ChatOptions,
  ): ChatCompletionBaseParams {
    const params: ChatCompletionBaseParams = {
      model: options.request.model,
      messages,
      max_tokens: options.request.maxOutputTokens,
      ...toThinkingParams(options.request),
    }

    if (options.responseFormat) {
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

/**
 * abort 时立即以 SDK 同款 `APIUserAbortError` 拒绝，不等 SDK 退避 sleep 醒来。
 * 晚醒的 SDK promise 落到已 settle 的 reject 上是 no-op，不会产生 unhandled rejection。
 */
function rejectOnAbort<T>(
  request: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal)
    return request

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new APIUserAbortError())

    signal.addEventListener('abort', onAbort, { once: true })
    request.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/** thinking 开关只对 DeepSeek reasoning 模型发；reasoning_effort 任何家族配置了就发，中转站会透传给上游。 */
function toThinkingParams(
  request: ResolvedChatRequestConfig,
): Pick<ChatCompletionBaseParams, 'thinking' | 'reasoning_effort'> {
  return {
    ...(request.reasoning ? { thinking: { type: 'enabled' as const } } : {}),
    ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
  }
}

function safelyCaptureRequest(
  debugCapture: ModelIODebugCapture | undefined,
  requestParams: unknown,
  onCaptureError: (side: ModelIODebugCaptureSide) => void,
): void {
  if (!debugCapture)
    return

  try {
    debugCapture.onRequest(requestParams)
  }
  catch {
    onCaptureError('request')
  }
}

export function toOpenAIModelInputItem(
  item: ModelInputItem,
): ChatCompletionMessageParam {
  switch (item.type) {
    case 'message':
      return {
        role: item.role,
        content: item.content,
      }

    case 'assistant_tool_call': {
      const message: AssistantToolCallMessageParam = {
        role: 'assistant',
        content: item.content ?? '',
        // 只有 DeepSeek thinking 会给出 reasoning_content；为空就不写字段，其他 Provider 不认识它。
        ...(item.reasoningContent ? { reasoning_content: item.reasoningContent } : {}),
        tool_calls: item.calls.map(call => ({
          id: call.callId,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: call.rawArgumentsJson,
          },
        })),
      }

      return message
    }

    case 'tool_result':
      return {
        role: 'tool',
        tool_call_id: item.callId,
        content: item.content,
      }
  }
}

export function toOpenAIChatTool(tool: ModelToolSpec): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.inputSchema.type,
        properties: tool.inputSchema.properties,
        required: tool.inputSchema.required,
        additionalProperties: tool.inputSchema.additionalProperties,
      },
    },
  }
}

export function toOpenAIChatTools(tools: ModelToolSpec[] | undefined): {
  tools?: ChatCompletionTool[]
} {
  return tools?.length
    ? {
        tools: tools.map(toOpenAIChatTool),
      }
    : {}
}
