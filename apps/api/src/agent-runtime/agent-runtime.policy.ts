import process from 'node:process'
import { Injectable } from '@nestjs/common'

const MAX_HISTORY_LIMIT = 1_000

export const DEFAULT_AGENT_RUNTIME_POLICY = {
  historyLimit: 40,
} as const

export interface AgentRuntimePolicy {
  historyLimit: number
}

@Injectable()
export class AgentRuntimePolicyService {
  readonly value = resolveAgentRuntimePolicy(process.env)
}

export function resolveAgentRuntimePolicy(
  env: NodeJS.ProcessEnv,
): AgentRuntimePolicy {
  const rawValue = env.SEO_CHAT_HISTORY_LIMIT

  if (rawValue === undefined)
    return DEFAULT_AGENT_RUNTIME_POLICY

  const value = rawValue.trim()

  if (!/^[1-9]\d*$/.test(value)) {
    throw new AgentRuntimePolicyError(
      `SEO_CHAT_HISTORY_LIMIT 必须是 1-${MAX_HISTORY_LIMIT} 范围内的十进制正整数`,
    )
  }

  const historyLimit = Number(value)

  if (!Number.isSafeInteger(historyLimit) || historyLimit > MAX_HISTORY_LIMIT) {
    throw new AgentRuntimePolicyError(
      `SEO_CHAT_HISTORY_LIMIT 必须是 1-${MAX_HISTORY_LIMIT} 范围内的十进制正整数`,
    )
  }

  return { historyLimit }
}

export class AgentRuntimePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentRuntimePolicyError'
  }
}
