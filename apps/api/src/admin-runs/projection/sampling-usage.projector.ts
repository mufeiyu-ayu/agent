import type { AdminRunTokenUsage, AgentRunErrorCode } from '@agent/contracts'
import { AGENT_RUN_ERROR_CODES } from '@agent/contracts'

import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { readNonNegativeInteger, readObject } from './safe-readers.js'

/** 上游模型调用本身失败的类别：请求已经发出，所以这类失败也算一次调用。概览 SQL 用同一份。 */
export const LLM_CALL_ERROR_CODES: readonly AgentRunErrorCode[] = AGENT_RUN_ERROR_CODES
  .filter(code => code.startsWith('llm_'))

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

export interface RunModelCallAggregate {
  count: number
  usage: AdminRunTokenUsage
}

/**
 * Run 真实发出的模型调用次数与 Token，与概览 SQL 同一口径：action sampling Step 与 finalization
 * attempt 中，有 usage 或以 llm_* 类别失败的才算。finalization attempt 不单独记类别，
 * 它的采样故障就是 Run 的终态原因，所以按 Run 的 errorCode 判断。
 * Token 只汇总带 usage 的调用：请求失败的调用没有用量，不让它把整条 Run 的 Token 变成未记录。
 */
export function aggregateRunModelCalls(
  steps: SamplingUsageStepRecord[],
  runErrorCode: string | null,
): RunModelCallAggregate {
  const usages: AdminRunTokenUsage[] = []
  let count = 0
  const record = (usage: AdminRunTokenUsage | null, failedUpstream: boolean) => {
    if (usage)
      usages.push(usage)
    if (usage || failedUpstream)
      count += 1
  }

  for (const step of steps) {
    if (step.type === AGENT_STEP_TYPES.modelSampling) {
      const output = readObject(step.output)
      record(projectTokenUsage(output), isLlmCallErrorCode(output?.errorCode))
    }
    else if (step.type === AGENT_STEP_TYPES.groundedFinalization) {
      for (const attempt of readFinalizationAttempts(step.output)) {
        const attemptRecord = readObject(attempt)
        record(
          projectTokenUsage(attemptRecord),
          typeof attemptRecord?.samplingFailure === 'string' && isLlmCallErrorCode(runErrorCode),
        )
      }
    }
  }

  return { count, usage: aggregateSamplingUsage(usages) }
}

function isLlmCallErrorCode(value: unknown): boolean {
  return typeof value === 'string' && (LLM_CALL_ERROR_CODES as readonly string[]).includes(value)
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
