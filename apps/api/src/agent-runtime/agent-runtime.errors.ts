import type { ModelFinishReason } from '@agent/ai'
import type { ModelSamplingSummary } from './sampling/model-sampling-decision.js'

/** Agent Loop 已耗尽服务端执行预算，不能伪装成正常回答。 */
export class AgentLoopLimitExceededError extends Error {
  constructor() {
    super('Agent Loop 已达到执行上限，未产生最终回答。')
    this.name = 'AgentLoopLimitExceededError'
  }
}

/** Run 超时的用户可见文案；终态归因不依赖 deadline reason 的具体形状。 */
export const AGENT_RUN_DEADLINE_EXCEEDED_MESSAGE = 'Agent Run 已达到执行时限。'

/** 整个 Agent Run 已超过统一执行时限。 */
export class AgentRunDeadlineExceededError extends Error {
  constructor() {
    super(AGENT_RUN_DEADLINE_EXCEEDED_MESSAGE)
    this.name = 'AgentRunDeadlineExceededError'
  }
}

/** Mandatory Context 已经无法在模型请求预算内安全保留。 */
export class ContextBudgetExceededError extends Error {
  constructor() {
    super('Mandatory Context 超出本轮输入预算，未调用模型。')
    this.name = 'ContextBudgetExceededError'
  }
}

/** 官方 tokenizer artifact 无法加载或编码，禁止静默退化估算。 */
export class ContextTokenEstimationError extends Error {
  constructor(readonly cause: unknown) {
    super('DeepSeek V4 TokenEstimator 无法完成请求前估算。')
    this.name = 'ContextTokenEstimationError'
  }
}

/** 终态持久化失败；原始 Run 原因不能被 cleanup 错误覆盖。 */
export class AgentRunTerminalizationError extends Error {
  constructor(
    readonly runCause: unknown,
    readonly terminalizationCause: unknown,
  ) {
    super('Agent Run 终态未能可靠持久化。')
    this.name = 'AgentRunTerminalizationError'
  }
}

/** 不能作为完整回答结束的 finish reason；stop / tool_calls 由调用方在此之前分派。 */
type IncompleteFinishReason = Exclude<ModelFinishReason, 'stop' | 'tool_calls'>

const INCOMPLETE_FINISH_REASON_MESSAGES: Record<IncompleteFinishReason, string> = {
  length: '模型输出达到长度限制，当前回答不完整。',
  content_filter: '模型输出被内容过滤，当前回答不完整。',
  unknown: '模型以未知原因结束，当前回答未被标记为成功。',
}

/**
 * 当前 sampling 无法作为一条完整助手回答结束。
 *
 * 流读取失败时原错误（通常是 LLMError）挂在 `cause` 上，终态归因按它映射失败类别与文案。
 */
export class ModelSamplingIncompleteError extends Error {
  constructor(
    message: string,
    readonly summary?: ModelSamplingSummary,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ModelSamplingIncompleteError'
  }

  /** `rawFinishReason` 是 adapter 清洗过的上游原值，只对 unknown 带进文案，便于区分资源不足、上游中止等原因。 */
  static fromFinishReason(
    finishReason: IncompleteFinishReason,
    summary?: ModelSamplingSummary,
    rawFinishReason?: string,
  ): ModelSamplingIncompleteError {
    return new ModelSamplingIncompleteError(
      finishReason === 'unknown' && rawFinishReason
        ? `模型以未知原因（${rawFinishReason}）结束，当前回答未被标记为成功。`
        : INCOMPLETE_FINISH_REASON_MESSAGES[finishReason],
      summary,
    )
  }
}
