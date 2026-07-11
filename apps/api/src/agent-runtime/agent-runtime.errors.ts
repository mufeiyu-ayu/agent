import type { ModelFinishReason } from '../llm/model-stream.types.js'

/** Tool Loop 尚未接入时，阻止模型 Tool Call 被静默当作成功回答。 */
export class ToolLoopNotImplementedError extends Error {
  constructor(toolNames: string[]) {
    const names = [...new Set(toolNames)].join(', ') || '未知工具'

    super(`模型请求了工具（${names}），但当前 Tool Loop 尚未实现。`)
    this.name = 'ToolLoopNotImplementedError'
  }
}

/** 当前 sampling 无法作为一条完整助手回答结束。 */
export class ModelSamplingIncompleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelSamplingIncompleteError'
  }

  static fromFinishReason(finishReason: ModelFinishReason): ModelSamplingIncompleteError {
    switch (finishReason) {
      case 'length':
        return new ModelSamplingIncompleteError('模型输出达到长度限制，当前回答不完整。')
      case 'content_filter':
        return new ModelSamplingIncompleteError('模型输出被内容过滤，当前回答不完整。')
      case 'unknown':
        return new ModelSamplingIncompleteError('模型以未知原因结束，当前回答未被标记为成功。')
      case 'stop':
      case 'tool_calls':
        return new ModelSamplingIncompleteError(`模型 sampling 无法以 ${finishReason} 完成。`)
    }
  }
}
