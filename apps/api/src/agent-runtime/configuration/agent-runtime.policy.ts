import process from 'node:process'
import { Injectable } from '@nestjs/common'

const MAX_HISTORY_CANDIDATE_LIMIT = 1_000
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

export const DEFAULT_AGENT_RUNTIME_POLICY = {
  /** 单次 Run 一次查询最多读取的历史候选消息总数。 */
  historyCandidateHardLimit: 1_000,
  /** 单次 Run 最多允许发起的模型采样轮数。 */
  maxSamplingRounds: 10,
  /** 单次 Run 最多允许执行的工具调用次数，按 call 计数，同轮多个 call 各算一次。 */
  maxToolCalls: 8,
  /** 单次 Run 正常执行阶段的最长时间，单位为毫秒。 */
  runDeadlineMs: 600_000,
} as const

export interface AgentRuntimePolicy {
  readonly historyCandidateHardLimit: number
  readonly maxSamplingRounds: number
  readonly maxToolCalls: number
  readonly runDeadlineMs: number
}

@Injectable()
export class AgentRuntimePolicyService {
  /** 应用启动时解析一次；单次 Run 只读取这份已校验策略。 */
  readonly value = resolveAgentRuntimePolicy(process.env)
}

export function resolveAgentRuntimePolicy(
  env: NodeJS.ProcessEnv,
): AgentRuntimePolicy {
  /** 单次 Run 一次查询读取的历史候选上限，不是最终进入模型的数量。 */
  const historyCandidateHardLimit = resolveInteger(
    env.AGENT_HISTORY_CANDIDATE_HARD_LIMIT,
    'AGENT_HISTORY_CANDIDATE_HARD_LIMIT',
    DEFAULT_AGENT_RUNTIME_POLICY.historyCandidateHardLimit,
    50,
    MAX_HISTORY_CANDIDATE_LIMIT,
  )
  /** 单次 Run 最多允许发起的模型采样总轮数。 */
  const maxSamplingRounds = resolveInteger(
    env.AGENT_MAX_SAMPLING_ROUNDS,
    'AGENT_MAX_SAMPLING_ROUNDS',
    DEFAULT_AGENT_RUNTIME_POLICY.maxSamplingRounds,
    1,
    Number.MAX_SAFE_INTEGER,
  )
  /** 单次 Run 最多允许执行的 action Tool Call 次数。 */
  const maxToolCalls = resolveInteger(
    env.AGENT_MAX_TOOL_CALLS,
    'AGENT_MAX_TOOL_CALLS',
    DEFAULT_AGENT_RUNTIME_POLICY.maxToolCalls,
    0,
    Number.MAX_SAFE_INTEGER,
  )
  /** AgentRun 创建成功后，正常执行阶段的总 deadline，单位为毫秒。 */
  const runDeadlineMs = resolveInteger(
    env.AGENT_RUN_DEADLINE_MS,
    'AGENT_RUN_DEADLINE_MS',
    DEFAULT_AGENT_RUNTIME_POLICY.runDeadlineMs,
    1,
    MAX_TIMER_TIMEOUT_MS,
  )

  // 两个上限各自独立：同轮可以有多个 Tool Call，「1 轮 3 个 call + 1 轮总结」是合法形态。
  return {
    historyCandidateHardLimit,
    maxSamplingRounds,
    maxToolCalls,
    runDeadlineMs,
  }
}

/** 将单个环境变量解析为带默认值和闭区间约束的安全整数；未配置时返回 fallback。 */
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
    value === ''
    || !Number.isSafeInteger(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    throw new AgentRuntimePolicyError(
      `${name} 必须是 ${minimum}-${maximum} 范围内的安全整数`,
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
