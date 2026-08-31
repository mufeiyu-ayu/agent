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
    // 综合模型上下文窗口、输出预留、安全余量和应用硬上限，
    // 算出本次 Run 各轮模型请求共用的输入 Token 预算。
    const resolvedInputBudgetTokens = resolveInitialContextBudget(input)

    // 传入数据库的「最新 -> 最旧」历史候选，返回它们与系统消息、
    // 当前用户消息和工具定义组成完整模型请求后的预估 Token 数。
    const estimate = (newestFirst: HistoryCandidate[]): number => {
      const historyMessages = newestFirst
        .map(candidate => candidate.message)
        // 数据库为分页保持倒序；模型上下文必须恢复为「最旧 -> 最新」。
        .reverse()

      return this.tokenEstimator.estimateRequest({
        items: toModelInputItems(input.buildModelMessages([
          ...historyMessages,
          input.currentUserMessage,
        ])),
        tools: input.tools,
      })
    }
    // 不带历史消息时仍必须容纳系统消息、当前用户消息和工具定义。
    const estimatedMandatoryTokens = estimate([])

    // 连必带内容都放不下时，删减历史消息也无法解决，直接终止。
    if (estimatedMandatoryTokens > resolvedInputBudgetTokens)
      throw new ContextBudgetExceededError()

    // 已确认纳入上下文的历史候选，始终保持数据库的「最新 -> 最旧」顺序。
    const selectedNewestFirst: HistoryCandidate[] = []
    // 已从数据库读取并检查的候选总数，用于限制本次 Run 的最大翻页量。
    let historyCandidateCount = 0
    // 已读取的当前批次中，因 Token 预算不足而未纳入的条数。
    let historyExcludedCount = 0
    // null 表示尚未排除；budget 表示预算不足；candidate_cap 表示已达候选总上限。
    let excludedReason: HistoryExcludedReason | null = null
    // 当前已选上下文的完整输入 Token 估算；初始时只有必带内容。
    let estimatedInputTokens = estimatedMandatoryTokens
    // keyset 分页位置；首批为 undefined，从当前用户消息之前的最新历史开始。
    let cursor: HistoryCursor | undefined

    // 每轮循环中，先拉取一批历史候选，再测算「已选历史 + 本批」能否整批放入预算。
    // 读取的历史候选总数< 规定的最历史数据上限时，继续翻页；否则终止。
    while (historyCandidateCount < input.candidateHardLimit) {
      // 查询前检查用户取消或 Run 超时。
      input.assertAvailable()
      // 每轮读多少条信息
      const take = Math.min(
        input.candidateBatchSize,
        input.candidateHardLimit - historyCandidateCount,
      )

      // 首批不带游标；后续从上一批最旧候选之后继续查询。
      const batch = await input.loadCandidates({
        ...(cursor ? { cursor } : {}),
        take,
      })
      // await 查询期间也可能发生取消或超时，返回后再检查一次。
      input.assertAvailable()

      // 没有更旧的历史消息了。
      if (batch.length === 0)
        // 跳出 while 循环，此时数据已全部读取完毕，或已达候选总上限。
        break

      // 先记录本批已检查，再测算「已选历史 + 本批」能否整批放入预算。
      historyCandidateCount += batch.length
      // 记录以及选中的历史信息+ 本批候选的完整输入 Token 估算。
      const allBatchTokens = estimate([...selectedNewestFirst, ...batch])

      if (allBatchTokens <= resolvedInputBudgetTokens) {
        // 消息按「最新 -> 最旧」顺序加入已选列表，供下一轮循环继续测算。
        selectedNewestFirst.push(...batch)
        // 当前已选上下文的完整输入 Token 估算
        estimatedInputTokens = allBatchTokens
        const lastCandidate = batch.at(-1)!

        // 记录分页游标，下一轮从本批最旧候选之后继续查询。
        cursor = {
          id: lastCandidate.id,
          createdAt: lastCandidate.createdAt,
        }

        // 如果本批数量不足 take，说明已经没有更多历史消息了，终止循环。
        if (batch.length < take)
          break

        if (historyCandidateCount === input.candidateHardLimit) {
          excludedReason = 'candidate_cap'
          break
        }

        continue
      }

      // 整批加入已超预算：在保持「优先最新、不跳过中间消息」的前提下，
      // 用二分查找算出本批从开头连续保留多少条才不超预算。
      const includedFromBatch = findLargestFittingPrefix(
        // 答案范围是 0 到本批总条数。
        batch.length,
        // 试算「已选历史 + 本批前 prefixLength 条」的完整请求 Token。
        prefixLength => estimate([
          ...selectedNewestFirst,
          ...batch.slice(0, prefixLength),
        ]),
        // 所有必带内容和历史消息共同遵守的输入上限。
        resolvedInputBudgetTokens,
      )

      // 只接收二分查找确认能放下的最新前缀。
      selectedNewestFirst.push(...batch.slice(0, includedFromBatch))
      // 记录本批已读取但因预算不足而未纳入的条数。
      historyExcludedCount = batch.length - includedFromBatch
      // 标记本次历史选择是因 Token 预算而停止。
      excludedReason = 'budget'
      // 使用最终已选历史重算一次，作为 summary 的最终输入估算。
      estimatedInputTokens = estimate(selectedNewestFirst)
      // 为保持连续的最新历史，不跳过本批未入选消息去搜索更旧数据。
      break
    }

    return {
      // 只返回模型需要的 role / content，不携带分页使用的 id 和 createdAt。
      historyMessages: selectedNewestFirst
        .map(candidate => candidate.message)
        // 选择时为便于数据库翻页保持「最新 -> 最旧」，
        // 返回模型前恢复为正常对话顺序「最旧 -> 最新」。
        .reverse(),
      summary: {
        // 本次 Run 实际解析到的模型名，用于观测和审计。
        resolvedModel: input.resolvedModel,
        // 该模型的输入与输出共享上下文窗口大小。
        contextWindowTokens: input.contextWindowTokens,
        // 即使模型窗口更大，应用也不允许输入超过该硬上限。
        applicationInputCapTokens:
          DEFAULT_INITIAL_CONTEXT_POLICY.applicationInputCapTokens,
        // 综合模型窗口、输出预留、安全余量和应用上限后的最终输入预算。
        resolvedInputBudgetTokens,
        // 本次请求为模型生成结果预留的最大输出 Token。
        resolvedMaxOutputTokens: input.resolvedMaxOutputTokens,
        // 额外保留但不放入任何内容的空间，避免贴着模型窗口上限组装请求。
        safetyMarginTokens:
          DEFAULT_INITIAL_CONTEXT_POLICY.safetyMarginTokens,
        // 系统提示词+tools +当前用户消息的预估 Token 数，始终纳入预算。
        estimatedMandatoryTokens,
        // 理论上可供历史消息使用的预算，不代表历史实际已经用满。
        historyBudgetTokens:
          resolvedInputBudgetTokens - estimatedMandatoryTokens,
        // 最终完整模型输入的预估 Token：必带内容 + 已选历史。
        estimatedInputTokens,
        // 本次实际从数据库读取并进入预算检查的历史候选总数。
        historyCandidateCount,
        // 最终纳入模型上下文的历史消息条数。
        historyIncludedCount: selectedNewestFirst.length,
        // 已读取的当前超预算批次中，未能纳入模型上下文的条数。
        historyExcludedCount,
        // budget：Token 预算不足；candidate_cap：达到候选上限；null：自然读完。
        excludedReason,
        // 本次预估使用的 Tokenizer / 请求编码策略版本，用于审计。
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

/**
 * 在 0..candidateCount 中找出最大的前缀长度，使该前缀组成的请求
 * 仍不超过 budget。estimate(n) 随前缀变长而不会减小，因此可以二分查找。
 */
function findLargestFittingPrefix(
  candidateCount: number,
  estimate: (prefixLength: number) => number,
  budget: number,
): number {
  // 本批取 0 条时只保留之前已验证的上下文，因此 0 是已知可行的下界。
  let lower = 0
  // 最多不可能超过本批总条数，作为搜索上界。
  let upper = candidateCount

  while (lower < upper) {
    // 向上取整，使两个候选值相邻时仍会试探较大的那一个。
    const middle = Math.ceil((lower + upper) / 2)

    // 前 middle 条能放下，答案至少是 middle，继续尝试更大前缀。
    if (estimate(middle) <= budget)
      lower = middle
    // 前 middle 条已超预算，middle 及更大前缀都排除。
    else
      upper = middle - 1
  }

  // 上下界重合时，lower 就是能放下的最大连续前缀长度。
  return lower
}
