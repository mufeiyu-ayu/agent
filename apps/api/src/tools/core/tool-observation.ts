export const TOOL_OBSERVATION_HARD_MAX_CHARS = 128_000

/**
 * 工具结果经过长度限制后，提供给模型和 AgentStep 记录使用的结构。
 *
 * 所有字符数量均按 Unicode code point 计算，Emoji 等字符不会被从中间拆开。
 */
export interface NormalizedToolObservation {
  /** 实际发送给模型的文本；超限时为带截断提示的开头预览。 */
  content: string
  /** 已受 Tool ceiling 约束、但不含 envelope 的正文预览，仅供 Context 层二次缩减。 */
  previewContent?: string
  /** 工具原始返回文本的字符数。 */
  originalChars: number
  /** 规范化后 `content` 的字符数。 */
  observationChars: number
  /** 原始文本是否因超过长度上限而被截断。 */
  truncated: boolean
}

/**
 * 规范化工具返回文本：未超限时原样返回，超限时返回带提示信息的开头预览。
 *
 * @returns 包含最终文本、处理前后字符数及是否截断的结构。
 */
export function normalizeToolObservation(
  content: string,
  requestedMaxChars = TOOL_OBSERVATION_HARD_MAX_CHARS,
): NormalizedToolObservation {
  if (
    !Number.isSafeInteger(requestedMaxChars)
    || requestedMaxChars <= 0
  ) {
    throw new RangeError('Tool Observation 字符预算必须是正整数')
  }

  const maxChars = Math.min(
    requestedMaxChars,
    TOOL_OBSERVATION_HARD_MAX_CHARS,
  )
  const previewCodePoints: string[] = []
  let originalChars = 0

  for (const codePoint of content) {
    originalChars += 1

    if (previewCodePoints.length < maxChars)
      previewCodePoints.push(codePoint)
  }

  if (originalChars <= maxChars) {
    return {
      content,
      originalChars,
      observationChars: originalChars,
      truncated: false,
    }
  }

  const prefix = `[工具 Observation 已截断，原始 ${originalChars} 字符；以下仅为预览]\n`
  const suffix = '\n[预览结束]'
  const envelopeChars = [...prefix, ...suffix].length

  if (envelopeChars > maxChars) {
    const content = [...`[工具 Observation 已截断，原始 ${originalChars} 字符]`]
      .slice(0, maxChars)
      .join('')

    return {
      content,
      previewContent: '',
      originalChars,
      observationChars: [...content].length,
      truncated: true,
    }
  }

  const previewChars = maxChars
    - [...prefix].length
    - [...suffix].length
  const normalizedContent = `${prefix}${previewCodePoints.slice(0, previewChars).join('')}${suffix}`

  return {
    content: normalizedContent,
    previewContent: previewCodePoints.slice(0, previewChars).join(''),
    originalChars,
    observationChars: [...normalizedContent].length,
    truncated: true,
  }
}
