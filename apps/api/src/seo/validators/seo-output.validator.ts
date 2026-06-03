import type { SeoGenerationOutput } from '../types/seo.types.js'
import { SeoGenerationOutputError } from '../types/seo.types.js'

export function parseSeoGenerationOutput(rawContent: string): SeoGenerationOutput {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawContent)
  }
  catch (cause) {
    throw new SeoGenerationOutputError('模型返回内容不是合法 JSON', {
      cause,
      preview: rawContent.slice(0, 200),
    })
  }

  return validateSeoGenerationOutput(parsed)
}

function validateSeoGenerationOutput(value: unknown): SeoGenerationOutput {
  if (!isRecord(value)) {
    throw new SeoGenerationOutputError('模型返回 JSON 必须是对象')
  }

  const title = readRequiredString(value, 'title')
  const description = readRequiredString(value, 'description')
  const suggestions = readSuggestionList(value, 'suggestions')

  return {
    title,
    description,
    suggestions,
  }
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]

  if (typeof value !== 'string') {
    throw new SeoGenerationOutputError(`模型返回字段 ${key} 必须是字符串`)
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    throw new SeoGenerationOutputError(`模型返回字段 ${key} 不能为空`)
  }

  return trimmedValue
}

function readSuggestionList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]

  if (!Array.isArray(value)) {
    throw new SeoGenerationOutputError(`模型返回字段 ${key} 必须是数组`)
  }

  if (value.length < 3 || value.length > 5) {
    throw new SeoGenerationOutputError(`模型返回字段 ${key} 必须包含 3 到 5 条建议`)
  }

  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new SeoGenerationOutputError(`模型返回字段 ${key}[${index}] 必须是字符串`)
    }

    const trimmedItem = item.trim()

    if (!trimmedItem) {
      throw new SeoGenerationOutputError(`模型返回字段 ${key}[${index}] 不能为空`)
    }

    return trimmedItem
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
