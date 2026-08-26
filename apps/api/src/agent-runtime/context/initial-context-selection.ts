import type { ChatMessage } from '../../llm/llm.types.js'
import type { ModelToolSpec } from '../../llm/model-tool-spec.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { toModelInputItems } from '../../llm/model-input.types.js'
import { ContextBudgetExceededError } from '../agent-runtime.errors.js'
import { TokenEstimator } from './deepseek-v4-token-estimator.js'

export const DEFAULT_INITIAL_CONTEXT_POLICY = {
  applicationInputCapTokens: 262_144,
  safetyMarginTokens: 16_384,
} as const

export interface HistoryCandidate {
  id: string
  createdAt: Date
  message: ChatMessage
}

export interface HistoryCursor {
  id: string
  createdAt: Date
}

export type HistoryExcludedReason = 'budget' | 'candidate_cap'

export interface InitialContextSelectionSummary {
  resolvedModel: string
  contextWindowTokens: number
  applicationInputCapTokens: number
  resolvedInputBudgetTokens: number
  resolvedMaxOutputTokens: number
  safetyMarginTokens: number
  estimatedMandatoryTokens: number
  historyBudgetTokens: number
  estimatedInputTokens: number
  historyCandidateCount: number
  historyIncludedCount: number
  historyExcludedCount: number
  excludedReason: HistoryExcludedReason | null
  estimatorStrategyId: string
}

interface SelectInitialContextInput {
  /** 本次 Run 解析后的模型名：决定 token 估算策略，并写入 summary 供审计。 */
  resolvedModel: string
  /** 模型的上下文窗口大小（token），用于计算本次可用输入预算。 */
  contextWindowTokens: number
  /** 要给模型回答预留的输出 token 数，从上下文窗口中扣除。 */
  resolvedMaxOutputTokens: number
  /** 每批通过 loadCandidates 拉取的历史候选条数（分批读取，而非一次全读）。 */
  candidateBatchSize: number
  /** 本次 Run 最多翻看的历史候选总条数上限，防止无限翻页。 */
  candidateHardLimit: number
  /** 当前这条用户消息，始终包含在给模型的上下文中。 */
  currentUserMessage: ChatMessage
  /** 可用工具的模型描述：参与 token 估算，决定工具定义占用的上下文空间。 */
  tools: ModelToolSpec[]
  /** 把历史消息组装成模型消息的函数（由调用方注入，保证与 Runtime 的组装方式一致）。 */
  buildModelMessages: (historyMessages: ChatMessage[]) => ChatMessage[]
  /** 按游标拉取一批评选历史候选的回调：select 需要时才调用，实现「边选边拉」。 */
  loadCandidates: (input: {
    cursor?: HistoryCursor
    take: number
  }) => Promise<HistoryCandidate[]>
  /** 每轮拉取前检查 Run 是否仍可用；超时 / 用户取消时抛错中止选择。 */
  assertAvailable: () => void
}

export interface InitialContextSelection {
  historyMessages: ChatMessage[]
  summary: InitialContextSelectionSummary
}

@Injectable()
export class InitialContextSelectionService {
  constructor(
    @Inject(TokenEstimator)
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  async select(
    input: SelectInitialContextInput,
  ): Promise<InitialContextSelection> {
    input.assertAvailable()
    const resolvedInputBudgetTokens = resolveInitialContextBudget(input)
    const estimate = (newestFirst: HistoryCandidate[]): number => {
      const historyMessages = newestFirst
        .map(candidate => candidate.message)
        .reverse()

      return this.tokenEstimator.estimateRequest({
        items: toModelInputItems(input.buildModelMessages([
          ...historyMessages,
          input.currentUserMessage,
        ])),
        tools: input.tools,
      })
    }
    const estimatedMandatoryTokens = estimate([])

    if (estimatedMandatoryTokens > resolvedInputBudgetTokens)
      throw new ContextBudgetExceededError()

    const selectedNewestFirst: HistoryCandidate[] = []
    let historyCandidateCount = 0
    let historyExcludedCount = 0
    let excludedReason: HistoryExcludedReason | null = null
    let estimatedInputTokens = estimatedMandatoryTokens
    let cursor: HistoryCursor | undefined

    while (historyCandidateCount < input.candidateHardLimit) {
      input.assertAvailable()
      const take = Math.min(
        input.candidateBatchSize,
        input.candidateHardLimit - historyCandidateCount,
      )
      const batch = await input.loadCandidates({
        ...(cursor ? { cursor } : {}),
        take,
      })
      input.assertAvailable()

      if (batch.length === 0)
        break

      historyCandidateCount += batch.length
      const allBatchTokens = estimate([...selectedNewestFirst, ...batch])

      if (allBatchTokens <= resolvedInputBudgetTokens) {
        selectedNewestFirst.push(...batch)
        estimatedInputTokens = allBatchTokens
        const lastCandidate = batch.at(-1)!

        cursor = {
          id: lastCandidate.id,
          createdAt: lastCandidate.createdAt,
        }

        if (batch.length < take)
          break

        if (historyCandidateCount === input.candidateHardLimit) {
          excludedReason = 'candidate_cap'
          break
        }

        continue
      }

      const includedFromBatch = findLargestFittingPrefix(
        batch.length,
        prefixLength => estimate([
          ...selectedNewestFirst,
          ...batch.slice(0, prefixLength),
        ]),
        resolvedInputBudgetTokens,
      )

      selectedNewestFirst.push(...batch.slice(0, includedFromBatch))
      historyExcludedCount = batch.length - includedFromBatch
      excludedReason = 'budget'
      estimatedInputTokens = estimate(selectedNewestFirst)
      break
    }

    return {
      historyMessages: selectedNewestFirst
        .map(candidate => candidate.message)
        .reverse(),
      summary: {
        resolvedModel: input.resolvedModel,
        contextWindowTokens: input.contextWindowTokens,
        applicationInputCapTokens:
          DEFAULT_INITIAL_CONTEXT_POLICY.applicationInputCapTokens,
        resolvedInputBudgetTokens,
        resolvedMaxOutputTokens: input.resolvedMaxOutputTokens,
        safetyMarginTokens:
          DEFAULT_INITIAL_CONTEXT_POLICY.safetyMarginTokens,
        estimatedMandatoryTokens,
        historyBudgetTokens:
          resolvedInputBudgetTokens - estimatedMandatoryTokens,
        estimatedInputTokens,
        historyCandidateCount,
        historyIncludedCount: selectedNewestFirst.length,
        historyExcludedCount,
        excludedReason,
        estimatorStrategyId: this.tokenEstimator.strategyId,
      },
    }
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

function findLargestFittingPrefix(
  candidateCount: number,
  estimate: (prefixLength: number) => number,
  budget: number,
): number {
  let lower = 0
  let upper = candidateCount

  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)

    if (estimate(middle) <= budget)
      lower = middle
    else
      upper = middle - 1
  }

  return lower
}
