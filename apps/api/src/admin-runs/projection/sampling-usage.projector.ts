import type { AdminRunTokenUsage } from '@agent/contracts'

import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { readNonNegativeInteger, readObject } from './safe-readers.js'

export interface SamplingUsageStepRecord {
  type: string
  output: unknown
}

/** 每个指标独立求和：任一条目该指标为 null，则该指标为 null，其余指标照常。 */
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

/** 汇总 grounded finalization Step 的模型调用次数与 Token：每个 attempt 就是一次真实模型调用。 */
export function aggregateGroundedFinalization(
  steps: SamplingUsageStepRecord[],
): GroundedFinalizationAggregate {
  const aggregate: GroundedFinalizationAggregate = { attemptCount: 0, usages: [] }

  for (const step of steps) {
    if (step.type !== AGENT_STEP_TYPES.groundedFinalization)
      continue

    const attempts = readFinalizationAttempts(step.output)

    aggregate.attemptCount += attempts.length
    for (const attempt of attempts)
      aggregate.usages.push(projectTokenUsage(readObject(attempt)))
  }

  return aggregate
}

/** 读取 finalization output 的 attempts；不是数组时视为没有记录到任何 attempt。 */
export function readFinalizationAttempts(output: unknown): unknown[] {
  const attempts = readObject(output)?.attempts
  return Array.isArray(attempts) ? attempts : []
}

export function projectTokenUsage(
  output: Record<string, unknown> | null,
): AdminRunTokenUsage | null {
  const usage = readObject(output?.usage)
  if (!usage)
    return null

  return {
    inputTokens: readNonNegativeInteger(usage, 'inputTokens'),
    outputTokens: readNonNegativeInteger(usage, 'outputTokens'),
    totalTokens: readNonNegativeInteger(usage, 'totalTokens'),
    reasoningTokens: readNonNegativeInteger(usage, 'reasoningTokens'),
    promptCacheHitTokens: readNonNegativeInteger(usage, 'promptCacheHitTokens'),
    promptCacheMissTokens: readNonNegativeInteger(usage, 'promptCacheMissTokens'),
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
