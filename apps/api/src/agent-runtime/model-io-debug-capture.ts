import type {
  AdminDebugModelIOCapture,
  AdminDebugModelResponseCapture,
} from '@agent/contracts'
import type {
  ModelIODebugCaptureSide,
  ModelRawResponseCapture,
} from '../llm/llm.types.js'

/** 一轮采样内的关联信息与 debug 原始值；未开启时两侧载荷均为 undefined。 */
export interface DebugModelIOCaptured {
  runId: string
  samplingAttemptId: string
  requestBody?: unknown
  rawResponse?: ModelRawResponseCapture
  failedSides?: ModelIODebugCaptureSide[]
}

/** 单侧捕获 JSON 序列化后的截断上限（约 200KB，以字符数近似）。 */
export const MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS = 200_000

/**
 * 把 debug 捕获的原始值收敛成可落库的信封。
 *
 * - 正常：{ truncated: false, value }（经 JSON round-trip，保证 Prisma Json 兼容）；
 * - 超限：{ truncated: true, preview } 只保留前缀字符串；
 * - 序列化失败（循环引用等）：返回 undefined，由调用方降级为不写并记 warning。
 */
export function toModelIODebugCaptureEnvelope(
  value: unknown,
): AdminDebugModelIOCapture | undefined {
  let json: string | undefined

  try {
    json = JSON.stringify(
      value,
      (key, child) => key === 'reasoning_content' ? undefined : child,
    )
  }
  catch {
    return undefined
  }

  if (typeof json !== 'string')
    return undefined

  if (json.length > MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS) {
    let preview = json.slice(0, MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS)
    const lastCode = preview.charCodeAt(preview.length - 1)

    // 截断点落在代理对中间会留下孤立高位代理，形成非法 JSON 字符串
    // （Postgres jsonb 会拒绝），去掉最后一个 code unit。
    if (lastCode >= 0xD800 && lastCode <= 0xDBFF)
      preview = preview.slice(0, -1)

    return {
      truncated: true,
      preview,
    }
  }

  return {
    truncated: false,
    value: JSON.parse(json),
  }
}

export function toModelIODebugResponseCaptureEnvelope(
  capture: ModelRawResponseCapture,
): AdminDebugModelResponseCapture | undefined {
  if (capture.state === 'empty')
    return { state: 'empty' }

  if (capture.rawResponse === undefined)
    return undefined

  const envelope = toModelIODebugCaptureEnvelope(capture.rawResponse)

  return envelope
    ? { state: capture.state, ...envelope }
    : undefined
}
