import process from 'node:process'
import { LLMConfigError } from '@agent/ai'
import { Injectable } from '@nestjs/common'

/** 密钥派生的输入长度下限；`openssl rand -hex 32` 生成的 64 位十六进制满足。 */
const SECRET_KEY_MIN_LENGTH = 32

export interface LlmEnvConfig {
  /** 加密 Provider API Key 的主密钥；模型与密钥本身都在数据库里。 */
  secretKey: string
  /** debug 开关：是否捕获 provider 原始请求 / 响应 JSON，默认关闭。 */
  captureModelIO: boolean
}

export function resolveLlmEnvConfig(env: NodeJS.ProcessEnv): LlmEnvConfig {
  const secretKey = env.AGENT_SECRET_KEY?.trim()

  if (!secretKey || secretKey.length < SECRET_KEY_MIN_LENGTH) {
    throw new LLMConfigError(
      'AGENT_SECRET_KEY',
      `必须设置且不少于 ${SECRET_KEY_MIN_LENGTH} 个字符（可用 openssl rand -hex 32 生成）`,
    )
  }

  return {
    secretKey,
    captureModelIO: readBooleanFlag(env, 'AGENT_DEBUG_CAPTURE_MODEL_IO'),
  }
}

function readBooleanFlag(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name]?.trim().toLowerCase()

  return value === '1' || value === 'true'
}

/** 启动期读一次 env：只剩主密钥与 debug 开关，模型接入配置全部来自数据库。 */
@Injectable()
export class LLMRuntimeConfigService {
  readonly value = resolveLlmEnvConfig(process.env)
}
