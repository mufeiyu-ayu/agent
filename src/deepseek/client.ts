import OpenAI from 'openai'

import { env } from '../config.js'

export function createDeepSeekClient() {
  return new OpenAI({
    baseURL: env.DEEPSEEK_BASE_URL,
    apiKey: env.DEEPSEEK_API_KEY,
  })
}
