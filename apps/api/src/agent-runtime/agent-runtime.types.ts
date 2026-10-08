import type { MessageInputItem } from '@agent/ai'
import type { ReasoningEffort } from '@agent/contracts'
import type { ResolvedLlmModel } from '../llm/llm-model-config.service.js'
import type { RuntimeConfigSnapshot } from '../runtime-config/runtime-config.service.js'

/** ChatService 提供的可信宿主快照；密钥由门面绑定，不传进内核。 */
export interface RunTurnStreamInput {
  /** 由后端登录态提供，仅代码工具使用。 */
  userId?: string
  conversationId: string
  /** 带了附件时可以是空串。 */
  userContent: string
  /** 已上传、随这条消息发出的附件 id；归属在绑定时按 userId 校验。 */
  attachmentIds?: string[]
  model: ResolvedLlmModel
  runtimeConfig: RuntimeConfigSnapshot
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
  instructions: MessageInputItem[]
}
