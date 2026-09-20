import type { MessageInputItem } from '@agent/ai'
import type { DeepSeekReasoningEffort, MessageGroundingV1 } from '@agent/contracts'
import type { ResolvedLlmModel } from '../llm/llm-model-config.service.js'

export type AgentRuntimeEvent
  = | {
    type: 'run_started'
    runId: string
    conversationId: string
    userMessageId: string
    assistantMessageId: string
  }
  | {
    type: 'assistant_delta'
    runId: string
    conversationId: string
    assistantMessageId: string
    contentDelta: string
  }
  | {
    type: 'run_completed'
    runId: string
    conversationId: string
    assistantMessageId: string
    content: string
    generatedAt: string
    /** 仅 Evidence-backed 回答携带；普通回答没有 Grounding。 */
    grounding?: MessageGroundingV1
  }
  | AgentRuntimeRunFailedEvent
  | {
    type: 'run_aborted'
    runId?: string
    conversationId: string
    assistantMessageId: string
    content: string
  }

export interface AgentRuntimeRunFailedEvent {
  type: 'run_failed'
  runId?: string
  conversationId: string
  assistantMessageId?: string
  /**
   * terminalization_unknown：终态收口失败或 COMMIT 结果未知，run 可能实际
   * 已成功提交；消费者应引导「刷新确认」而不是「重试」，避免重复发送计费。
   */
  failureReason?: 'conversation_not_found' | 'terminalization_unknown'
  message: string
}

export interface RunTurnStreamInput {
  conversationId: string
  userContent: string
  /** Run 开始前解析好的模型配置快照：整个 Run 用同一份，后台改配置对下一个 Run 生效。 */
  model: ResolvedLlmModel
  /** 只对 reasoning 模型有意义；省略时回落 high。 */
  reasoningEffort?: DeepSeekReasoningEffort
  signal?: AbortSignal
  /** 模型必须携带的指令消息（当前为系统提示词）；历史与当前消息由 Runtime 自行拼接。 */
  instructions: MessageInputItem[]
}
