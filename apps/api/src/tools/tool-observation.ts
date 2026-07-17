export const MAX_TOOL_OBSERVATION_CHARS = 8_000

export interface NormalizedToolObservation {
  content: string
  originalChars: number
  observationChars: number
  truncated: boolean
}

export function normalizeToolObservation(content: string): NormalizedToolObservation {
  const previewCodePoints: string[] = []
  let originalChars = 0

  for (const codePoint of content) {
    originalChars += 1

    if (previewCodePoints.length < MAX_TOOL_OBSERVATION_CHARS)
      previewCodePoints.push(codePoint)
  }

  if (originalChars <= MAX_TOOL_OBSERVATION_CHARS) {
    return {
      content,
      originalChars,
      observationChars: originalChars,
      truncated: false,
    }
  }

  const prefix = `[工具 Observation 已截断，原始 ${originalChars} 字符；以下仅为预览]\n`
  const suffix = '\n[预览结束]'
  const previewChars = MAX_TOOL_OBSERVATION_CHARS
    - [...prefix].length
    - [...suffix].length
  const normalizedContent = `${prefix}${previewCodePoints.slice(0, previewChars).join('')}${suffix}`

  return {
    content: normalizedContent,
    originalChars,
    observationChars: [...normalizedContent].length,
    truncated: true,
  }
}
