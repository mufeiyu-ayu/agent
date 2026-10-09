import type { ChatStreamToolFinishedEvent, ChatStreamToolStartedEvent } from '@agent/contracts'

export type GenerationStatus = 'empty' | 'idle' | 'thinking' | 'generating' | 'done' | 'error' | 'aborted'

export type ConversationTurnStatus = 'thinking' | 'generating' | 'success' | 'error' | 'aborted'

/**
 * 消息里的一个附件。`url` 是完整内容的地址：这次页面里刚发出的是本地 object URL（不用再下载一遍），
 * 从接口读到的是后端地址。
 */
export interface ChatAttachment {
  id: string
  kind: 'image' | 'file'
  name: string
  bytes: number
  url: string
  /** 图片在消息列表里显示用的缩略图地址；没有就直接用 `url`。 */
  thumbUrl?: string
  /** 图片原始尺寸：消息列表按它预留位置，加载出来不推动下面的内容。 */
  width?: number
  height?: number
}

/** 输入框里还没发出的附件。 */
export interface ComposerAttachment extends ChatAttachment {
  /** 上传成功后服务端给的附件 id，发送时带的是它；`id` 只是页面里的本地标识。 */
  remoteId?: string
  /** 已交给正在提交的请求：去向确认前不能移除、不能再发，也不撤销消息副本使用的 URL。 */
  locked?: boolean
  /** 此地址已经用于消息预览，由工作区回收；重新上传给草稿另建地址。 */
  inMessage?: boolean
  status: 'uploading' | 'ready' | 'error'
  /** 0–1。 */
  progress: number
}

export interface ConversationTurn {
  id: string
  userMessage: string
  attachments?: ChatAttachment[]
  status: ConversationTurnStatus
  createdAt: string
  reply?: string
  generatedAt?: string
  errorMessage?: string
  /** 本轮的等待过程：当前页面里发出的轮次来自流事件（#208），其余的由接口下发的 activity 还原（#212）。 */
  run?: TurnRun
}

/**
 * 一次工具调用在界面上的进度与结果：字段取自 tool_started / tool_finished 事件（协议只在 contracts 维护一处）。
 * 在 steps 里的下标就是它的身份：不同轮次的 callId 可能重复。
 */
export interface TurnRunStep
  extends Pick<ChatStreamToolStartedEvent, 'callId' | 'toolName' | 'query' | 'url'>,
  Pick<ChatStreamToolFinishedEvent, 'failure' | 'results' | 'finalUrl' | 'title' | 'chars' | 'workspace'> {
  /** stopped：执行中被停止或出错打断，没有等到 tool_finished。 */
  status: 'running' | 'ok' | 'failed' | 'stopped' | 'skipped'
}

/**
 * 一轮思考的原文（#209）：一轮从 start 或 tool_finished 开始，到下一个 tool_started 或正文开始为止。
 * 同一轮开始时的步骤数各不相同，时间线据此把思考行排在第 `at` 个步骤之前。
 */
export interface TurnRunThought {
  at: number
  text: string
}

/**
 * 一轮回答的等待过程（#208）：waiting 是思考中（start 之后、tool_finished 之后），
 * tool 是工具执行中，answering 是正文在写，ended 是 done / error / aborted 或本地停止之后。
 * 时间都是 performance.now()：单调时钟，系统校时不会让状态行消失或计时倒退。
 * 刷新后还原的轮次（#212）一开始就是 ended：startedAt 记 0、answerAt 是接口给的毫秒数，没有 endedAt。
 */
export interface TurnRun {
  /** start 事件到达的时刻：计时、1 秒阈值与「用时」都从这里算。 */
  startedAt: number
  /** 第一段正文到达的时刻。 */
  answerAt?: number
  endedAt?: number
  phase: 'waiting' | 'tool' | 'answering' | 'ended'
  /** 怎么结束的：本地停止记为 aborted，网络等异常记为 error。 */
  outcome?: 'done' | 'error' | 'aborted'
  /** 正文开始前调过工具：这一轮一定有状态行。 */
  toolBeforeAnswer: boolean
  steps: TurnRunStep[]
  /** 有思考原文的模型才有（#209），拿不到的模型始终为空。 */
  thoughts: TurnRunThought[]
}

export type AppMessageType = 'error' | 'success' | 'info'

export interface AppMessageState {
  visible: boolean
  type: AppMessageType
  text: string
}
