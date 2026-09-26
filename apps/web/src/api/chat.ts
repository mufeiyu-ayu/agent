import type {
  ApiErrorResponse,
  ChatRequest,
  ChatStreamEvent,
} from '@agent/contracts'

interface StreamChatOptions {
  signal?: AbortSignal
}

/** 流接口在写出 NDJSON 之前就拒绝了请求（非 2xx）。 */
export class ChatStreamHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /**
     * 模型行不可用（已隐藏 / 删除、服务商停用、强度不属于该家族）：这是流接口写出响应头前唯一的业务 400，
     * 不带 `error.details`；DTO 校验失败的 400 带 details。
     */
    readonly isModelUnavailable: boolean,
  ) {
    super(message)
    this.name = 'ChatStreamHttpError'
  }
}

export async function* streamChat(
  payload: ChatRequest,
  options: StreamChatOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: {
      'Accept': 'application/x-ndjson',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    ...(options.signal ? { signal: options.signal } : {}),
  })

  if (!response.ok) {
    throw await readStreamHttpError(response)
  }

  if (!response.body) {
    throw new Error('流式响应体为空，请稍后重试')
  }

  yield* parseChatStreamEvents(response.body)
}

async function* parseChatStreamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const result = await reader.read()

      if (result.done)
        break

      buffer += decoder.decode(result.value, { stream: true })
      const lines = buffer.split(/\r?\n/)

      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const event = parseChatStreamEventLine(line)

        if (event)
          yield event
      }
    }

    buffer += decoder.decode()

    if (buffer.trim()) {
      for (const line of buffer.split(/\r?\n/)) {
        const event = parseChatStreamEventLine(line)

        if (event)
          yield event
      }
    }
  }
  finally {
    // 解析异常或消费者提前退出时必须 cancel：只 releaseLock 不会关闭底层
    // HTTP 连接，后端会继续采样、计费并把消息持久化为 COMPLETED，与 UI
    // 的失败状态背离。流已正常读完时 cancel 是 no-op。
    try {
      await reader.cancel()
    }
    catch {
      // 连接可能已被 abort；取消失败无需处理。
    }
    finally {
      reader.releaseLock()
    }
  }
}

/** 单行 NDJSON 解析入口；导出供协议回归测试直接消费。 */
export function parseChatStreamEventLine(line: string): ChatStreamEvent | null {
  const trimmedLine = line.trim()

  if (!trimmedLine)
    return null

  let value: unknown

  try {
    value = JSON.parse(trimmedLine) as unknown
  }
  catch {
    throw new Error('流式响应 JSON 解析失败，请稍后重试')
  }

  if (!isChatStreamEvent(value)) {
    throw new Error('流式响应事件格式不正确，请稍后重试')
  }

  return value
}

function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (!isRecord(value) || typeof value.type !== 'string')
    return false

  switch (value.type) {
    case 'start':
      return (
        typeof value.conversationId === 'string'
        && typeof value.userMessageId === 'string'
        && typeof value.assistantMessageId === 'string'
      )
    case 'delta':
      return (
        typeof value.conversationId === 'string'
        && typeof value.assistantMessageId === 'string'
        && typeof value.contentDelta === 'string'
      )
    case 'done':
      return (
        typeof value.conversationId === 'string'
        && typeof value.assistantMessageId === 'string'
        && typeof value.content === 'string'
        && typeof value.generatedAt === 'string'
      )
    case 'error':
      return (
        typeof value.conversationId === 'string'
        && typeof value.message === 'string'
        && (
          value.assistantMessageId === undefined
          || typeof value.assistantMessageId === 'string'
        )
        && (value.userMessagePersisted === undefined || typeof value.userMessagePersisted === 'boolean')
      )
    case 'aborted':
      return (
        typeof value.conversationId === 'string'
        && typeof value.assistantMessageId === 'string'
        && typeof value.content === 'string'
      )
    default:
      return false
  }
}

async function readStreamHttpError(response: Response): Promise<ChatStreamHttpError> {
  try {
    const payload = await response.json() as Partial<ApiErrorResponse>

    if (typeof payload.message === 'string') {
      const details = payload.error?.details
      const isModelUnavailable = response.status === 400 && !(Array.isArray(details) && details.length > 0)

      return new ChatStreamHttpError(payload.message, response.status, isModelUnavailable)
    }
  }
  catch {
    // 非 JSON 错误响应时使用 HTTP 状态码兜底。
  }

  return new ChatStreamHttpError(`请求失败（${response.status}）`, response.status, false)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
