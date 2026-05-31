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

  return {
    title,
    description,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
