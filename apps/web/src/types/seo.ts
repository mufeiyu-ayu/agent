import type { MessageGroundingV1 } from '@agent/contracts'

export type GenerationStatus = 'empty' | 'idle' | 'thinking' | 'generating' | 'done' | 'error' | 'aborted'

export type SeoConversationTurnStatus = 'thinking' | 'generating' | 'success' | 'error' | 'aborted'

export interface SeoConversationTurn {
  id: string
  userMessage: string
  status: SeoConversationTurnStatus
  createdAt: string
  reply?: string
  generatedAt?: string
  errorMessage?: string
  /**
   * 已完成助手回答的引用事实。
   *
   * 直接复用公共 contract 类型，不在 Web 侧另立一套会漂移的 Grounding 结构；
   * 只有 COMPLETED assistant Message 才会带上它。
   */
  grounding?: MessageGroundingV1
}

export type AppMessageType = 'error' | 'success' | 'info'

export interface AppMessageState {
  visible: boolean
  type: AppMessageType
  text: string
}
