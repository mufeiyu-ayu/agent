import type { ModelToolSpec } from '@agent/ai'
import type { TokenEstimator } from './deepseek-v4-token-estimator.js'
import type { ModelContext } from './model-context.js'

import { ContextBudgetExceededError } from '../agent-runtime.errors.js'
import { flattenPlanningState } from './model-context.js'

/**
 * 首轮采样前的快照，原样写入每个 sampling Step 输入 `initialContext`（Admin 的 Run 模型快照与请求详情都读它）。
 * 历史条数与裁剪结果不在这里：读取阶段不裁剪，预算裁剪只体现在 planner 的 `contextPlan`。
 */
export interface InitialContextSummary {
  resolvedModel: string
  /** 本次 Run 快照的 Provider 与模型行 id，供 Admin 追溯这轮打的是谁。 */
  providerId: string
  modelId: string
  /** 唯一参与后续业务的字段：每轮 plan() 用它判断输入是否超预算。 */
  resolvedInputBudgetTokens: number
}

interface SummarizeInitialContextInput {
  /** 本次 Run 解析后的模型名，写入快照供审计；token 估算当前一律用 DeepSeek V4 estimator。 */
  resolvedModel: string
  providerId: string
  modelId: string
  /** 本次 Run 的输入预算：模型行的「单次输入上限」，保存时已校验不超过窗口容量，这里不再截小。 */
  resolvedInputBudgetTokens: number
  /** 已装入全部历史候选的 ModelContext；估算走与 planner 相同的 flattenPlanningState。 */
  context: ModelContext
  /** 可用工具的模型描述：参与 token 估算，决定工具定义占用的上下文空间。 */
  tools: ModelToolSpec[]
  tokenEstimator: TokenEstimator
}

/**
 * 记下本次 Run 的输入预算，并对必带内容做一次估算。
 * 不做任何裁剪：全部候选的估算与超预算删最旧都由 SamplingContextPlanner 在首轮 plan() 完成；
 * 连必带内容都放不下时直接抛 ContextBudgetExceededError，不调用模型。
 */
export function summarizeInitialContext(
  input: SummarizeInitialContextInput,
): InitialContextSummary {
  const { resolvedInputBudgetTokens } = input
  // 只在工作副本上清空历史，与 planner 用同一份组装顺序估算，不改动 ModelContext。
  const state = input.context.forPlanning()

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
    providerId: input.providerId,
    modelId: input.modelId,
    resolvedInputBudgetTokens,
  }
}
