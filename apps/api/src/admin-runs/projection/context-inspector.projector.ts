import type {
  AdminContextInspector,
  AdminContextObservationSummary,
} from '@agent/contracts'

import {
  readAllowedString,
  readNonNegativeInteger,
  readObject,
  readString,
} from './safe-readers.js'

/**
 * 按 sampling Step 的 `input.initialContext` 与 `output.contextPlan` 逐字段投影。
 *
 * 字段能读就读，读不出就 null；不做跨字段等式或跨 Step 序列检查。
 */
export function projectContextInspector(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminContextInspector {
  const initialContext = readObject(input?.initialContext)
  const contextPlan = readObject(output?.contextPlan)
  const contextFailureReason = readAllowedString(
    output,
    'contextFailureReason',
    ['estimator_failure'],
  )
  const overflowReason = readAllowedString(
    contextPlan,
    'overflowReason',
    ['minimum_context'],
  )
  const initialIncludedCount = readNonNegativeInteger(
    initialContext,
    'historyIncludedCount',
  )
  const planIncludedCount = readNonNegativeInteger(
    contextPlan,
    'historyIncludedCount',
  )

  return {
    outcome: contextFailureReason === 'estimator_failure'
      ? 'estimator_failure'
      : overflowReason === 'minimum_context'
        ? 'minimum_context_overflow'
        : contextPlan
          ? 'success'
          : null,
    resolvedModel: readString(initialContext, 'resolvedModel'),
    // 预算在 plan 前就已解析并写入 initialContext；history 三项都是 plan 的结果，只读 contextPlan。
    resolvedInputBudgetTokens: readNonNegativeInteger(contextPlan, 'resolvedInputBudgetTokens')
      ?? readNonNegativeInteger(initialContext, 'resolvedInputBudgetTokens'),
    estimatedInputTokens: readNonNegativeInteger(contextPlan, 'estimatedInputTokens'),
    historyCandidateCount: readNonNegativeInteger(contextPlan, 'historyCandidateCount'),
    historyIncludedCount: planIncludedCount,
    samplingHistoryExcludedCount: initialIncludedCount !== null && planIncludedCount !== null
      ? initialIncludedCount - planIncludedCount
      : null,
    observations: readContextObservationSummaries(contextPlan?.observations),
  }
}

/**
 * 逐条、逐字段读取 Observation 摘要；不是数组返回 null。
 *
 * 展示按数组下标编号（第 N 轮 Tool Exchange），因此单条读不出时保留位置、
 * 只把读不出的字段置 null，不跳过也不拖垮整个数组。
 */
function readContextObservationSummaries(
  value: unknown,
): AdminContextObservationSummary[] | null {
  if (!Array.isArray(value))
    return null

  return value.map((candidate) => {
    const object = readObject(candidate)

    return {
      originalChars: readNonNegativeInteger(object, 'originalChars'),
      toolCeilingChars: readNonNegativeInteger(object, 'toolCeilingChars'),
      finalChars: readNonNegativeInteger(object, 'finalChars'),
    }
  })
}
