import process from 'node:process'
import { Injectable } from '@nestjs/common'

const MAX_HISTORY_LIMIT = 1_000
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

export const DEFAULT_AGENT_RUNTIME_POLICY = {
  historyLimit: 40,
  maxSamplingRounds: 3,
  maxToolCalls: 2,
  runDeadlineMs: 600_000,
} as const

export interface AgentRuntimePolicy {
  historyLimit: number
  maxSamplingRounds: number
  maxToolCalls: number
  runDeadlineMs: number
}

@Injectable()
export class AgentRuntimePolicyService {
  readonly value = resolveAgentRuntimePolicy(process.env)
}

export function resolveAgentRuntimePolicy(
  env: NodeJS.ProcessEnv,
): AgentRuntimePolicy {
  const historyLimit = resolveInteger(
    env.SEO_CHAT_HISTORY_LIMIT,
    'SEO_CHAT_HISTORY_LIMIT',
    DEFAULT_AGENT_RUNTIME_POLICY.historyLimit,
    1,
    MAX_HISTORY_LIMIT,
  )
  const maxSamplingRounds = resolveInteger(
    env.AGENT_MAX_SAMPLING_ROUNDS,
    'AGENT_MAX_SAMPLING_ROUNDS',
    DEFAULT_AGENT_RUNTIME_POLICY.maxSamplingRounds,
    1,
    Number.MAX_SAFE_INTEGER,
  )
  const maxToolCalls = resolveInteger(
    env.AGENT_MAX_TOOL_CALLS,
    'AGENT_MAX_TOOL_CALLS',
    DEFAULT_AGENT_RUNTIME_POLICY.maxToolCalls,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  const runDeadlineMs = resolveInteger(
    env.AGENT_RUN_DEADLINE_MS,
    'AGENT_RUN_DEADLINE_MS',
    DEFAULT_AGENT_RUNTIME_POLICY.runDeadlineMs,
    1,
    MAX_TIMER_TIMEOUT_MS,
  )

  if (maxToolCalls >= maxSamplingRounds) {
    throw new AgentRuntimePolicyError(
      'AGENT_MAX_TOOL_CALLS 必须小于 AGENT_MAX_SAMPLING_ROUNDS',
    )
  }

  return {
    historyLimit,
    maxSamplingRounds,
    maxToolCalls,
    runDeadlineMs,
  }
}

function resolveInteger(
  rawValue: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (rawValue === undefined)
    return fallback

  const value = rawValue.trim()
  const parsed = Number(value)

  if (
    !/^(?:0|[1-9]\d*)$/.test(value)
    || !Number.isSafeInteger(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    throw new AgentRuntimePolicyError(
      `${name} 必须是 ${minimum}-${maximum} 范围内的十进制安全整数`,
    )
  }

  return parsed
}

export class AgentRuntimePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentRuntimePolicyError'
  }
}
