import process from 'node:process'
import { Injectable } from '@nestjs/common'

const MAX_HISTORY_CANDIDATE_LIMIT = 1_000
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

export const DEFAULT_AGENT_RUNTIME_POLICY = {
  /** 每批从数据库读取的历史候选消息数。 */
  historyCandidateBatchSize: 50,
  /** 单次 Run 最多检查的历史候选消息总数。 */
  historyCandidateHardLimit: 1_000,
  /** 单次 Run 最多允许发起的模型采样轮数。 */
  maxSamplingRounds: 3,
  /** 单次 Run 最多允许执行的工具调用次数。 */
  maxToolCalls: 2,
  /** 单次 Run 正常执行阶段的最长时间，单位为毫秒。 */
  runDeadlineMs: 600_000,
} as const

export interface AgentRuntimePolicy {
  historyCandidateBatchSize: number
  historyCandidateHardLimit: number
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
  const historyCandidateBatchSize = resolveInteger(
    env.SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE,
    'SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE',
    DEFAULT_AGENT_RUNTIME_POLICY.historyCandidateBatchSize,
    50,
    MAX_HISTORY_CANDIDATE_LIMIT,
  )
  const historyCandidateHardLimit = resolveInteger(
    env.SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT,
    'SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT',
    DEFAULT_AGENT_RUNTIME_POLICY.historyCandidateHardLimit,
    50,
    MAX_HISTORY_CANDIDATE_LIMIT,
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
  if (historyCandidateBatchSize > historyCandidateHardLimit) {
    throw new AgentRuntimePolicyError(
      'SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE 不得大于 SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT',
    )
  }

  return {
    historyCandidateBatchSize,
    historyCandidateHardLimit,
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
