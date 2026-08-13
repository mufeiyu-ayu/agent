import type { ModelFinishReason } from '../llm/model-stream.types.js'
import type { ModelSamplingSummary } from './model-sampling-decision.js'

/** Agent Loop 已耗尽服务端执行预算，不能伪装成正常回答。 */
export class AgentLoopLimitExceededError extends Error {
  constructor() {
    super('Agent Loop 已达到执行上限，未产生最终回答。')
    this.name = 'AgentLoopLimitExceededError'
  }
}

/** 整个 Agent Run 已超过统一执行时限。 */
export class AgentRunDeadlineExceededError extends Error {
  constructor() {
    super('Agent Run 已达到执行时限。')
    this.name = 'AgentRunDeadlineExceededError'
  }
}

/** Mandatory Context 已经无法在模型请求预算内安全保留。 */
export class ContextBudgetExceededError extends Error {
  constructor(
    readonly stage: 'initial_context' | 'sampling_context' = 'initial_context',
  ) {
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

/** 当前 sampling 无法作为一条完整助手回答结束。 */
export class ModelSamplingIncompleteError extends Error {
  constructor(
    message: string,
    readonly summary?: ModelSamplingSummary,
  ) {
    super(message)
    this.name = 'ModelSamplingIncompleteError'
  }

  static fromFinishReason(
    finishReason: ModelFinishReason,
    summary?: ModelSamplingSummary,
  ): ModelSamplingIncompleteError {
    switch (finishReason) {
      case 'length':
        return new ModelSamplingIncompleteError(
          '模型输出达到长度限制，当前回答不完整。',
          summary,
        )
      case 'content_filter':
        return new ModelSamplingIncompleteError(
          '模型输出被内容过滤，当前回答不完整。',
          summary,
        )
      case 'unknown':
        return new ModelSamplingIncompleteError(
          '模型以未知原因结束，当前回答未被标记为成功。',
          summary,
        )
      case 'stop':
      case 'tool_calls':
        return new ModelSamplingIncompleteError(
          `模型 sampling 无法以 ${finishReason} 完成。`,
          summary,
        )
    }
  }
}
