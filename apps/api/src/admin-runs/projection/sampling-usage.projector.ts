import type { AdminRunTokenUsage } from '@agent/contracts'

import { GROUNDED_FINALIZATION_MAX_ATTEMPTS } from '../../agent-runtime/grounding/grounded-answer.finalizer.js'
import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import {
  isRequiredNonNegativeInteger,
  readNonNegativeInteger,
  readObject,
} from './safe-readers.js'

export interface SamplingUsageStepRecord {
  type: string
  output: unknown
}

export function aggregateSamplingUsage(
  usages: Array<AdminRunTokenUsage | null>,
): AdminRunTokenUsage {
  return {
    inputTokens: sumCompleteUsage(usages, 'inputTokens'),
    outputTokens: sumCompleteUsage(usages, 'outputTokens'),
    totalTokens: sumCompleteUsage(usages, 'totalTokens'),
    reasoningTokens: sumCompleteUsage(usages, 'reasoningTokens'),
    promptCacheHitTokens: sumCompleteUsage(usages, 'promptCacheHitTokens'),
    promptCacheMissTokens: sumCompleteUsage(usages, 'promptCacheMissTokens'),
  }
}

export interface GroundedFinalizationAggregate {
  attemptCount: number
  usages: Array<AdminRunTokenUsage | null>
}

/**
 * 汇总 grounded finalization Step 的模型调用次数与 Token。
 *
 * fail closed 而不是静默少算：metadata 损坏时无法知道真实 attempt 数，
 * 此时按「至少发生过一次模型调用」计数（Step 存在就说明调用过），并把 usage
 * 记为不可用，让整个 Run 的 Token 汇总变成 null，而不是给出偏低的假数字。
 */
export function aggregateGroundedFinalization(
  steps: SamplingUsageStepRecord[],
): GroundedFinalizationAggregate {
  const finalizationSteps = steps.filter(
    step => step.type === AGENT_STEP_TYPES.groundedFinalization,
  )
  const aggregate: GroundedFinalizationAggregate = {
    attemptCount: 0,
    usages: finalizationSteps.length > 1 ? [null] : [],
  }

  for (const step of finalizationSteps) {
    const attempts = readFinalizationAttempts(step.output)

    if (!attempts) {
      aggregate.attemptCount += 1
      aggregate.usages.push(null)
      continue
    }

    aggregate.attemptCount += attempts.length
    for (const attempt of attempts)
      aggregate.usages.push(projectTokenUsage(attempt))
  }

  return aggregate
}

/**
 * 读取 finalization Step 的 attempts 元数据。
 *
 * @returns 合法时返回 attempt 对象列表；缺失、类型错误或超出 attempt 上限时返回 null。
 */
function readFinalizationAttempts(
  output: unknown,
): Array<Record<string, unknown>> | null {
  const record = readObject(output)

  if (!record || !Array.isArray(record.attempts))
    return null

  if (record.attempts.length > GROUNDED_FINALIZATION_MAX_ATTEMPTS)
    return null

  if (
    !isRequiredNonNegativeInteger(record, 'attemptCount')
    || record.attemptCount !== record.attempts.length
  ) {
    return null
  }

  const attempts: Array<Record<string, unknown>> = []

  for (const candidate of record.attempts) {
    const attempt = readObject(candidate)

    if (!attempt || typeof attempt.ok !== 'boolean')
      return null

    attempts.push(attempt)
  }

  return attempts
}

export function projectTokenUsage(
  output: Record<string, unknown> | null,
): AdminRunTokenUsage | null {
  const usage = readObject(output?.usage)
  if (!usage)
    return null

  const inputTokens = readNonNegativeInteger(usage, 'inputTokens')
  const outputTokens = readNonNegativeInteger(usage, 'outputTokens')
  const reasoningTokens = readNonNegativeInteger(usage, 'reasoningTokens')
  const promptCacheHitTokens = readNonNegativeInteger(
    usage,
    'promptCacheHitTokens',
  )
  const promptCacheMissTokens = readNonNegativeInteger(
    usage,
    'promptCacheMissTokens',
  )
  const cacheBreakdownValid = inputTokens === null
    || promptCacheHitTokens === null
    || promptCacheMissTokens === null
    || (Number.isSafeInteger(promptCacheHitTokens + promptCacheMissTokens)
      && promptCacheHitTokens + promptCacheMissTokens === inputTokens)

  return {
    inputTokens,
    outputTokens,
    totalTokens: readNonNegativeInteger(usage, 'totalTokens'),
    reasoningTokens: outputTokens !== null
      && reasoningTokens !== null
      && reasoningTokens > outputTokens
      ? null
      : reasoningTokens,
    promptCacheHitTokens: cacheBreakdownValid ? promptCacheHitTokens : null,
    promptCacheMissTokens: cacheBreakdownValid ? promptCacheMissTokens : null,
  }
}

function sumCompleteUsage(
  usages: Array<AdminRunTokenUsage | null>,
  key: keyof AdminRunTokenUsage,
): number | null {
  if (usages.length === 0)
    return null

  let total = 0
  for (const usage of usages) {
    const value = usage?.[key]
    if (value === null || value === undefined)
      return null

    total += value
    if (!Number.isSafeInteger(total))
      return null
  }

  return total
}
