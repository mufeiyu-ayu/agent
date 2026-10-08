import type { MessageInputItem, ModelToolSpec } from '@agent/ai'
import type { ReasoningEffort } from '@agent/contracts'
import type { RuntimeConfig, RuntimeModel } from './host.js'
import type { ToolDisplay } from './tools/tool.types.js'

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
  // 思考原文分片（#209）：只给界面，不进 Message.content 与模型上下文；事件本身不落库（每轮完整思考随采样 Step 落库，#212）。
  | {
    type: 'reasoning_delta'
    runId: string
    conversationId: string
    assistantMessageId: string
    delta: string
  }
  // 工具进度（#208）：只给界面，不进模型上下文；事件本身不落库（display 随 tool Step 落库，#212）。
  | {
    type: 'tool_started'
    workspace?: ToolDisplay['workspace']
    runId: string
    conversationId: string
    assistantMessageId: string
    callId: string
    toolName: string
    /** 从模型参数里尽力取出的查询词 / 网址，只用于展示。 */
    query?: string
    url?: string
  }
  | ({
    type: 'tool_finished'
    runId: string
    conversationId: string
    assistantMessageId: string
    callId: string
    ok: boolean
  } & ToolDisplay)
  | {
    type: 'run_completed'
    runId: string
    conversationId: string
    assistantMessageId: string
    content: string
    generatedAt: string
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
  /** 用户消息已落库（会话 updatedAt 已更新）之后才失败；前台据此同步侧栏顺序。 */
  userMessagePersisted?: true
}

export interface RunTurnStreamInput {
  conversationId: string
  /** 带了附件时可以是空串。 */
  userContent: string
  /** 已上传、随这条消息发出的附件 id。 */
  attachmentIds?: string[]
  /** Run 开始前解析好的模型配置快照：整个 Run 用同一份，后台改配置对下一个 Run 生效。 */
  model: RuntimeModel
  tools: ModelToolSpec[]
  /** Run 开始前读好的无凭据运行配置快照。 */
  runtimeConfig: RuntimeConfig
  /** 请求级覆盖模型行的默认 reasoning_effort；省略时用模型行的。 */
  reasoningEffort?: ReasoningEffort
  signal?: AbortSignal
  /** 模型必须携带的指令消息（当前为系统提示词）；历史与当前消息由 Runtime 自行拼接。 */
  instructions: MessageInputItem[]
}
