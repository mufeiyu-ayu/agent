import process from 'node:process'
import { Injectable } from '@nestjs/common'

const MAX_HISTORY_CANDIDATE_LIMIT = 1_000
const MAX_TIMER_TIMEOUT_MS = 2_147_483_647

export const DEFAULT_AGENT_RUNTIME_POLICY = {
  /** 每次分页查询（每页）从数据库读取的历史候选消息数量。 */
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
  readonly historyCandidateBatchSize: number
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
  /** 每次分页查询（每页）读取的历史候选消息数量，不是最终进入模型的数量。 */
  const historyCandidateBatchSize = resolveInteger(
    env.SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE,
    'SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE',
    DEFAULT_AGENT_RUNTIME_POLICY.historyCandidateBatchSize,
    50,
    MAX_HISTORY_CANDIDATE_LIMIT,
  )
  /** 单次 Run 最多检查的历史候选总数，防止无限翻页。 */
  const historyCandidateHardLimit = resolveInteger(
    env.SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT,
    'SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT',
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

/** 将单个环境变量解析为带默认值和闭区间约束的安全整数。 */
function resolveInteger(
  /** 环境变量原始字符串；未配置时为 undefined。 */
  rawValue: string | undefined,
  /** 配置项名称，仅用于生成明确的错误信息。 */
  name: string,
  /** 未配置该环境变量时使用的默认值。 */
  fallback: number,
  /** 允许值的下界，包含该值。 */
  minimum: number,
  /** 允许值的上界，包含该值。 */
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
