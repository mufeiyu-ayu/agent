import type { MessageInputItem } from '@agent/ai'
import type { ReasoningEffort } from '@agent/contracts'
import type { ResolvedLlmModel } from '../llm/llm-model-config.service.js'
import type { RuntimeConfigSnapshot } from '../runtime-config/runtime-config.service.js'

/** ChatService 提供的可信宿主快照；密钥由门面绑定，不传进内核。 */
export interface RunTurnStreamInput {
  userId?: string
  conversationId: string
  userContent: string
  model: ResolvedLlmModel
  runtimeConfig: RuntimeConfigSnapshot
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
  instructions: MessageInputItem[]
}
