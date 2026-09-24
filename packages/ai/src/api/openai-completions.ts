import type { ReasoningEffort } from '@agent/contracts'
import type {
  ChatCompletionAssistantMessageParam,
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
const STREAM_TIMEOUT_MS = 600_000
/**
 * 交给 SDK 内置重试的瞬态失败次数（408 / 409 / 429 / 5xx、连接错误；退避与
 * `retry-after` 由 SDK 处理）。重试边界是首个响应头之前：流正文中断不重试，
 * 已推给调用方的 delta 无法撤回；abort 信号触发后也不再重试。
 * SDK 的退避 sleep 不监听 signal，且对 `retry-after` 不设上限，`chatStream`
 * 与元数据请求用 `rejectOnAbort` 让 abort 立即胜出，deadline / 用户停止 /
 * 调用方的整体超时不会被 sleep 拖住。
 */
const REQUEST_MAX_RETRIES = 2
/** 上游错误里的 code / type / message 进文案前各自的长度上限。 */
const UPSTREAM_ERROR_TEXT_MAX_CHARS = 200

type ChatCompletionBaseParams = Pick<
  ChatCompletionCreateParamsStreaming,
  'messages' | 'model' | 'max_tokens'
> & {
  /** 思考开关只对 compat.thinkingFormat 为 'deepseek' 的家族发。 */
  thinking?: { type: 'enabled' }
  /** 任何家族配置了就发，取值按家族见 contracts 的 LLM_FAMILY_CAPABILITIES。 */
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

  /** `signal` 由调用方给整体时间上界：SDK 的 timeout 按尝试计时，重试退避也不听 signal。 */
  async listModels(options: { signal?: AbortSignal } = {}): Promise<ProviderModelsResponse> {
    return await this.getMetadata<ProviderModelsResponse>('/models', options.signal)
  }

  /** DeepSeek 的余额端点在 origin 下（`/user/balance`），不在 `/v1` 前缀下；用绝对 URL 绕过 baseURL 拼接。 */
  async getUserBalance(options: { signal?: AbortSignal } = {}): Promise<ProviderBalanceResponse> {
    const url = new URL('/user/balance', this.clientConfig.baseUrl).href

    return await this.getMetadata<ProviderBalanceResponse>(url, options.signal)
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
              signal,
            )
          : stream,
        {
          requireReasoningContent: options.request.compat.requiresReasoningContent,
          toolCallIndexOptional: options.request.compat.toolCallIndexOptional,
          toolCallsMayFinishWithStop: options.request.compat.toolCallsMayFinishWithStop,
        },
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
      // SDK 读响应体时遇到 abort 会静默结束迭代，adapter 随后报「没有 finish reason」；
      // 先看 signal，已 aborted 就按与首个响应头之前 abort 相同的方式处理，不当成协议异常。
      throw this.toLLMError(signal?.aborted ? new APIUserAbortError() : cause)
    }
  }

  private createClient(): OpenAI {
    const { apiKey, baseUrl, fetchOptions } = this.clientConfig

    return new OpenAI({
      apiKey,
      baseURL: baseUrl,
      ...(fetchOptions ? { fetchOptions } : {}),
      maxRetries: REQUEST_MAX_RETRIES,
      // SDK 解析不了 SSE 行时会用 console.error 把整行上游原文打到 stderr；错误本身照常抛出。
      logLevel: 'off',
    })
  }

  private buildBaseChatCompletionParams(
    messages: ChatCompletionMessageParam[],
    options: ChatStreamOptions,
  ): ChatCompletionBaseParams {
    return {
      model: options.request.model,
      messages,
      max_tokens: options.request.maxOutputTokens,
      ...toThinkingParams(options.request),
    }
  }

  private async getMetadata<T>(path: string, signal: AbortSignal | undefined): Promise<T> {
    try {
      return await rejectOnAbort(
        this.createClient().get<T>(path, {
          timeout: METADATA_REQUEST_TIMEOUT_MS,
          ...(signal ? { signal } : {}),
        }),
        signal,
      )
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

    // SDK 解析上游 JSON 失败（SSE `data:` 行或元数据响应体）：数据不合协议，不是网络问题；文案不带上游片段。
    if (cause instanceof SyntaxError)
      return new LLMApiError('模型服务返回了无法解析的数据', cause)

    return new LLMNetworkError(cause)
  }

  private toLLMHttpError(error: APIError): LLMError {
    // 流内夹带的 error 对象被 SDK 抛成 status 为空的 APIError；它带着 HTTP 状态码时按同一张表归类。
    const status = error.status ?? statusOfStreamError(error.error)
    // 进文案的上游摘要：非 JSON body 可能是整页 HTML 或任意文本，SDK 会把它原样放进 `error.message`，而文案会进
    // 管理台「测试模型」结果与 `lastProbeError`。只有 body 解析成 JSON 且 `error` 是对象时，才取字符串类型的
    // code / type 与截断后的 message；完整 APIError 留在 `detail` 上。401 / 402 / 403 / 429 的文案已足够定位，不带摘要。
    const upstream = describeJsonErrorBody(error.error, this.clientConfig.apiKey)

    // 中转站把「中转站到上游失败」包成 400 + `upstream_error`（流内则 code 为 null），与请求体无关，
    // 按服务端故障归类；流内没有状态码时按网关故障记 502。沿用上游 401 / 429 等状态码的照常按状态码归类。
    // SDK 已把 error 对象的 type 放在 `error.type` 上。SDK 不重试 400，这类故障不会像 502 那样自动重试。
    if ((status === 400 || status === undefined) && error.type === 'upstream_error')
      return new LLMServerError(status ?? 502, error, upstream)

    switch (status) {
      case 400:
        return new LLMInvalidRequestError(400, error, upstream)
      case 401:
      case 403:
        return new LLMAuthError(status, error)
      case 402:
        return new LLMBalanceError(error)
      case 422:
        return new LLMInvalidRequestError(422, error, upstream)
      case 429:
        return new LLMRateLimitError(error)
      default:
        // 中转站常见的 502 / 504 与 500 / 503 同属上游服务端故障。
        if (status !== undefined && status >= 500)
          return new LLMServerError(status, error, upstream)

        // 未单独映射的状态码（404 / 405 等）只报状态与摘要。
        return new LLMApiError(
          `LLM API ${status ? `HTTP ${status}` : '未知 HTTP 状态'} 错误${upstream ? `: ${upstream}` : ''}`,
          error,
        )
    }
  }
}

/** 流内 error 对象的 `code` 是 4xx / 5xx 状态码（数值或三位数字字符串）时取出来；其余（含 200 这类业务码）为 undefined。 */
function statusOfStreamError(body: unknown): number | undefined {
  const code = typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>).code
    : undefined
  const status = typeof code === 'number' || (typeof code === 'string' && /^\d{3}$/.test(code))
    ? Number(code)
    : undefined

  return status !== undefined && status >= 400 && status <= 599 ? status : undefined
}

/**
 * SDK 的 `APIError.error` 是 JSON body 里的 `error` 字段；非 JSON body 时为 undefined。
 * 上游可能在报错里原样回显请求用的 key，先把它换成 `***` 再截断，截断不会留下半截 key。
 * 少于 8 个字符的是本地 / 中转站的占位 key（`none`、`EMPTY`），不是秘密，替换反而会把正文打乱。
 */
function describeJsonErrorBody(body: unknown, apiKey: string): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return ''

  const redact = (value: string) => apiKey.length >= 8 ? value.replaceAll(apiKey, '***') : value
  const { code, type, message } = body as Record<string, unknown>
  const labels = [code, type]
    .flatMap(value => typeof value === 'string' ? [sanitizeUpstreamText(redact(value))] : [])
    .filter(Boolean)
  const text = typeof message === 'string' ? sanitizeUpstreamText(redact(message)) : ''

  return [labels.length > 0 ? `[${labels.join(' / ')}]` : '', text].filter(Boolean).join(' ')
}

/** 上游文本进文案前：控制与格式字符（换行、双向覆盖、零宽字符）换成空格，压缩空白，截断到 200 字符以内，不在代理对中间切开。 */
function sanitizeUpstreamText(value: string): string {
  const text = value.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim()

  return text.length > UPSTREAM_ERROR_TEXT_MAX_CHARS
    ? `${text.slice(0, UPSTREAM_ERROR_TEXT_MAX_CHARS - 1).replace(/[\uD800-\uDBFF]$/, '')}…`
    : text
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

/** thinking 开关按家族 compat 表决定格式，目前只有 DeepSeek 一种；reasoning_effort 任何家族配置了就发，中转站会透传给上游。 */
function toThinkingParams(
  request: ResolvedChatRequestConfig,
): Pick<ChatCompletionBaseParams, 'thinking' | 'reasoning_effort'> {
  return {
    ...(request.compat.thinkingFormat === 'deepseek' ? { thinking: { type: 'enabled' as const } } : {}),
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
