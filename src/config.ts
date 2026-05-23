import process from 'node:process'

import { z } from 'zod'
import { DEEPSEEK_MODELS } from './deepseek/types.js'

import 'dotenv/config'

const envSchema = z.object({
  DEEPSEEK_API_KEY: z.string().trim().min(1, '请在 .env 中填写 DeepSeek API Key'),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.enum(DEEPSEEK_MODELS).default('deepseek-v4-pro'),
  DEEPSEEK_THINKING: z.enum(['enabled', 'disabled']).default('enabled'),
  DEEPSEEK_REASONING_EFFORT: z.enum(['high', 'max']).default('high'),
})

function loadEnv() {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    const details = parsed.error.issues
      .map(issue => `- ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')

    throw new Error(`环境变量配置不完整：\n${details}\n\n请复制 .env.example 为 .env，并填入 DEEPSEEK_API_KEY。`)
  }

  return parsed.data
}

export const env = loadEnv()
