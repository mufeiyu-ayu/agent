import type {
  ApiErrorResponse,
  ChatStreamEvent,
  SeoChatRequest,
} from '@agent/contracts'

import { parseMessageGroundingV1 } from '@agent/contracts'

interface StreamChatWithSeoAgentOptions {
  signal?: AbortSignal
}

export async function* streamChatWithSeoAgent(
  payload: SeoChatRequest,
  options: StreamChatWithSeoAgentOptions = {},
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch('/api/seo/chat/stream', {
    method: 'POST',
    headers: {
      'Accept': 'application/x-ndjson',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    ...(options.signal ? { signal: options.signal } : {}),
  })

  if (!response.ok) {
    throw new Error(await getStreamHttpErrorMessage(response))
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

  return sanitizeChatStreamEvent(value)
}

/**
 * 保留已知事件语义，并安全接受 `done` 上可选的 grounding。
 *
 * 语义校验直接复用 `@agent/contracts` 的 `parseMessageGroundingV1`，与服务端
 * durable projector 是同一份实现：availability / outcome 枚举、outcome × availability
 * 组合、Citation 数量与来源约束、安全整数、字段长度、article/chunk 一致性、
 * href 必须为 null、citationId 唯一，两侧结论完全一致。
 *
 * 与服务端的唯一区别是失败处理：这里只丢弃这个可选字段，不让 UI / 审计元数据
 * 拖垮整条回答流。本 Task 不渲染来源卡片。
 */
function sanitizeChatStreamEvent(event: ChatStreamEvent): ChatStreamEvent {
  if (event.type !== 'done' || event.grounding === undefined)
    return event

  const grounding = parseMessageGroundingV1(event.grounding)

  if (grounding)
    return { ...event, grounding }

  const { grounding: _grounding, ...rest } = event

  return rest
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
    // grounding 是 done 上的可选 UI / 审计元数据，由 sanitizeChatStreamEvent 单独处理：
    // 它损坏时不应该让整条回答流失败。
    case 'error':
      return (
        typeof value.conversationId === 'string'
        && typeof value.message === 'string'
        && (
          value.assistantMessageId === undefined
          || typeof value.assistantMessageId === 'string'
        )
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

async function getStreamHttpErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as Partial<ApiErrorResponse>

    if (typeof payload.message === 'string')
      return payload.message
  }
  catch {
    // 非 JSON 错误响应时使用 HTTP 状态码兜底。
  }

  return `请求失败（${response.status}）`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
