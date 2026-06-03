import type { GenerateSeoRequest, GenerateSeoResponse, SeoStreamEvent } from '../types/seo'
import type { ApiErrorResponse } from './http'

import { http } from './http'

interface StreamSeoOptions {
  onEvent: (event: SeoStreamEvent) => void
}

interface RawSseMessage {
  event: string
  data: unknown
}

export async function generateSeoContent(payload: GenerateSeoRequest): Promise<GenerateSeoResponse> {
  const response = await http.post<GenerateSeoResponse>('/api/seo/generate', payload)

  return response.data
}

export async function streamGenerateSeoContent(
  payload: GenerateSeoRequest,
  options: StreamSeoOptions,
): Promise<void> {
  const response = await fetch('/api/seo/generate/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await readHttpErrorMessage(response))
  }

  if (!response.body) {
    throw new Error('Streaming response is not available.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()

    if (done)
      break

    buffer += decoder.decode(value, { stream: true })
    buffer = consumeSseBuffer(buffer, options.onEvent)
  }

  buffer += decoder.decode()
  consumeSseBuffer(buffer, options.onEvent, true)
}

function consumeSseBuffer(
  buffer: string,
  onEvent: (event: SeoStreamEvent) => void,
  flush = false,
): string {
  const normalizedBuffer = buffer.replace(/\r\n/g, '\n')
  const chunks = normalizedBuffer.split('\n\n')
  const remaining = flush ? '' : chunks.pop() ?? ''
  const completeChunks = flush ? chunks.filter(Boolean) : chunks

  for (const chunk of completeChunks) {
    const rawMessage = parseSseChunk(chunk)

    if (!rawMessage)
      continue

    onEvent(toSeoStreamEvent(rawMessage))
  }

  return remaining
}

function parseSseChunk(chunk: string): RawSseMessage | null {
  const lines = chunk.split('\n')
  const eventLine = lines.find(line => line.startsWith('event:'))
  const dataLines = lines.filter(line => line.startsWith('data:'))

  if (!eventLine)
    return null

  const event = eventLine.replace(/^event:\s*/, '').trim()
  const dataText = dataLines
    .map(line => line.replace(/^data:\s*/, ''))
    .join('\n')

  return {
    event,
    data: dataText ? JSON.parse(dataText) as unknown : {},
  }
}

function toSeoStreamEvent(message: RawSseMessage): SeoStreamEvent {
  if (message.event === 'result' && isGenerateSeoResponse(message.data)) {
    return {
      type: 'result',
      data: message.data,
    }
  }

  if (message.event === 'done') {
    return {
      type: 'done',
    }
  }

  if (message.event === 'error') {
    return {
      type: 'error',
      message: readMessage(message.data, 'AI 服务异常，请稍后重试'),
    }
  }

  if (message.event === 'started') {
    return {
      type: 'started',
      message: readMessage(message.data, 'Request accepted'),
    }
  }

  return {
    type: 'progress',
    message: readMessage(message.data, 'Generating SEO content'),
  }
}

function isGenerateSeoResponse(value: unknown): value is GenerateSeoResponse {
  if (typeof value !== 'object' || value === null)
    return false

  const record = value as Record<string, unknown>

  return (
    typeof record.title === 'string'
    && typeof record.description === 'string'
    && Array.isArray(record.suggestions)
    && record.suggestions.every(item => typeof item === 'string')
    && typeof record.generatedAt === 'string'
  )
}

function readMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'object' || value === null)
    return fallback

  const message = (value as Record<string, unknown>).message

  return typeof message === 'string' ? message : fallback
}

async function readHttpErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json() as ApiErrorResponse

    return data.message || 'Failed to generate SEO content. Please try again.'
  }
  catch {
    return 'Failed to generate SEO content. Please try again.'
  }
}
