import type { ModelToolSpec } from '@agent/ai'
import type { TokenEstimator } from './deepseek-v4-token-estimator.js'
import type { ModelContext } from './model-context.js'

import { ContextBudgetExceededError } from '../agent-runtime.errors.js'
import { flattenPlanningState } from './model-context.js'

export const DEFAULT_INITIAL_CONTEXT_POLICY = {
  applicationInputCapTokens: 262_144,
  safetyMarginTokens: 16_384,
} as const

/**
 * 首轮采样前的裁剪前快照：前四个字段写入 sampling Step 输入 `initialContext`
 * （Admin Context Inspector 的读取契约），后两个写入 load_conversation_history 的 output。
 * 预算裁剪只体现在 planner 的 `contextPlan`，因此这里 included 恒等于 candidate、excluded 恒为 0。
 */
export interface InitialContextSummary {
  resolvedModel: string
  resolvedInputBudgetTokens: number
  historyCandidateCount: number
  historyIncludedCount: number
  historyExcludedCount: number
  /** 读取条数触到硬上限时为 candidate_cap，否则 null；不再出现 budget。 */
  excludedReason: 'candidate_cap' | null
}

interface SummarizeInitialContextInput {
  /** 本次 Run 解析后的模型名：决定 token 估算策略，并写入快照供审计。 */
  resolvedModel: string
  /** 模型的上下文窗口大小（token），用于计算本次可用输入预算。 */
  contextWindowTokens: number
  /** 要给模型回答预留的输出 token 数，从上下文窗口中扣除。 */
  resolvedMaxOutputTokens: number
  /** 单次查询允许读取的历史条数上限；读满即标记 candidate_cap。 */
  candidateHardLimit: number
  /** 已装入全部历史候选的 ModelContext；估算走与 planner 相同的 flattenPlanningState。 */
  context: ModelContext
  /** 可用工具的模型描述：参与 token 估算，决定工具定义占用的上下文空间。 */
  tools: ModelToolSpec[]
  tokenEstimator: TokenEstimator
}

/**
 * 解析本次 Run 的输入预算，并对必带内容做一次估算。
 * 不做任何裁剪：全部候选的估算与超预算删最旧都由 SamplingContextPlanner 在首轮 plan() 完成；
 * 连必带内容都放不下时直接抛 ContextBudgetExceededError，不调用模型。
 */
export function summarizeInitialContext(
  input: SummarizeInitialContextInput,
): InitialContextSummary {
  const resolvedInputBudgetTokens = resolveInitialContextBudget(input)
  // 只在工作副本上清空历史，与 planner 用同一份组装顺序估算，不改动 ModelContext。
  const state = input.context.forPlanning()
  const historyCandidateCount = state.initialHistoryCandidateCount

  // 不带历史消息时仍必须容纳系统消息、当前用户消息和工具定义。
  state.initialHistory = []
  const estimatedMandatoryTokens = input.tokenEstimator.estimateRequest({
    items: flattenPlanningState(state),
    tools: input.tools,
  })

  if (estimatedMandatoryTokens > resolvedInputBudgetTokens)
    throw new ContextBudgetExceededError()

  return {
    resolvedModel: input.resolvedModel,
    resolvedInputBudgetTokens,
    historyCandidateCount,
    historyIncludedCount: historyCandidateCount,
    historyExcludedCount: 0,
    excludedReason: historyCandidateCount === input.candidateHardLimit
      ? 'candidate_cap'
      : null,
  }
}

export function resolveInitialContextBudget(input: {
  contextWindowTokens: number
  resolvedMaxOutputTokens: number
}): number {
  const modelInputCapacity = input.contextWindowTokens
    - input.resolvedMaxOutputTokens
    - DEFAULT_INITIAL_CONTEXT_POLICY.safetyMarginTokens

  if (modelInputCapacity <= 0)
    throw new ContextBudgetExceededError()

  return Math.min(
    DEFAULT_INITIAL_CONTEXT_POLICY.applicationInputCapTokens,
    modelInputCapacity,
  )
}
