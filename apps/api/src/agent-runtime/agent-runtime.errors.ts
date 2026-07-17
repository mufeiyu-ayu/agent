import type { ModelFinishReason } from '../llm/model-stream.types.js'
import type { ModelSamplingSummary } from './model-sampling-decision.js'

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

/** 用户可见 Message 已由另一条终态路径收口，当前路径不得继续推进 Run。 */
export class MessageTerminalTransitionError extends Error {
  constructor(messageId: string) {
    super(`Message ${messageId} 已进入终态，拒绝迟到更新`)
    this.name = 'MessageTerminalTransitionError'
  }
}
