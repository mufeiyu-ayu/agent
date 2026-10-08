import type { ChatStreamOptions, LLMError, LLMModelProfile, MessageImage, MessageInputItem, ModelInputItem, ModelStreamEvent, ModelUsage } from '@agent/ai'
import type { AgentRunErrorCode } from '@agent/contracts'
import type { ContextCompactionService } from './context/context-compaction.service.js'
import type { ConversationHistory, HistoryCompactionRecord } from './context/conversation-history.js'
import type { ToolDisplay, ToolInvocationResult, UnvalidatedToolCallEnvelope } from './tools/tool.types.js'

/** 记录的 JSON 副本，不包含驱动特殊值、函数或宿主对象。 */
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
export interface JsonObject { [key: string]: JsonValue | undefined }

export interface OperationDeadline {
  deadlineAt: number
  signal?: AbortSignal
  createTimeoutError: () => Error
}
export type HostErrorKind = 'deadline' | 'commit_outcome_unknown' | 'conversation_not_found' | undefined
export type ClassifyHostError = (error: unknown) => HostErrorKind
export interface RuntimeModel {
  modelId: string
  providerId: string
  family: string
  profile: LLMModelProfile
  maxInputTokens: number
}
export interface RuntimeConfig {
  limits: { readonly runDeadlineMs: number }
  compactionKeepRecentTokens: number
  debugCaptureModelIo: boolean
}
export interface StoredMessage {
  id: string
  content: string
  createdAt: Date
  updatedAt: Date
}
/**
 * 用户消息落库后交给内核的那一份。`content` 仍是用户打的字；`modelContent` 与 `images` 是模型看到的：
 * 附件抽出的文字已按 `userMessageContent` 拼进正文，图片已从存储读出。两者都取自落库的附件记录，历史读取时按同样的方式还原。
 */
export interface StoredUserMessage extends StoredMessage {
  modelContent: string
  images?: MessageImage[]
}
export interface StepClose {
  input?: JsonObject
  output?: JsonObject
}
export interface CloseAgentStepInput {
  id: string
  errorMessage: string
  output?: JsonObject
}
export interface AssistantSnapshot {
  id: string
  conversationId: string
  content: string
}

export const AGENT_STEP_TYPES = {
  loadConversationHistory: 'load_conversation_history',
  modelSampling: 'model_sampling',
  toolExecution: 'tool_execution',
  assistantOutput: 'assistant_output',
  contextCompaction: 'context_compaction',
} as const
export type AgentStepType = typeof AGENT_STEP_TYPES[keyof typeof AGENT_STEP_TYPES]

/** 只暴露当前执行循环需要的业务操作；事务和提交所有权仍由宿主实现。 */
export interface RunRecorder {
  createRun: (input: { conversationId: string, userMessageId: string }) => Promise<{ id: string }>
  createAssistantMessage: (runId: string, conversationId: string, deadline: OperationDeadline) => Promise<StoredMessage>
  startStep: (input: { runId: string, type: AgentStepType, input?: JsonObject }, deadline: OperationDeadline) => Promise<{ id: string }>
  completeStep: (id: string, deadline: OperationDeadline, close?: StepClose) => Promise<void>
  failStep: (id: string, deadline: OperationDeadline, close: StepClose & { errorMessage: string }) => Promise<void>
  completeRun: (input: Omit<AssistantSnapshot, 'id'> & { runId: string, assistantMessageId: string, assistantOutputStepId: string }, deadline: OperationDeadline, onCommitOwned: () => void) => Promise<StoredMessage>
  abortRun: (id: string, deadline: OperationDeadline, message?: AssistantSnapshot, step?: CloseAgentStepInput) => Promise<void>
  failRun: (id: string, message: string, code: AgentRunErrorCode, deadline: OperationDeadline, assistant?: AssistantSnapshot, step?: CloseAgentStepInput) => Promise<void>
}
export interface RuntimeLogger {
  warn: (message: object | string) => void
  error: (message: string, trace?: string) => void
}
export interface CompactionRecordInput {
  conversationId: string
  runId: string
  reason: 'threshold' | 'overflow' | 'after_run'
  summary: string
  coveredGroupIds: string[]
  answerOnlyGroupId: string | null
  readAt: Date
  tokensBefore: number
  usage?: JsonObject
  modelId: string
}
export interface CompactionHost {
  stream: (items: ModelInputItem[], options: ChatStreamOptions) => AsyncIterable<ModelStreamEvent>
  recorder: RunRecorder
  logger: RuntimeLogger
  createTimeoutError: () => Error
  loadHistory: (conversationId: string, before: Pick<StoredMessage, 'id' | 'createdAt'> | undefined, deadline: OperationDeadline) => Promise<{ history: ConversationHistory, messageCount: number }>
  insertCompaction: (input: CompactionRecordInput, deadline: OperationDeadline) => Promise<HistoryCompactionRecord>
}
export interface RuntimeHost extends Omit<CompactionHost, 'insertCompaction'> {
  compaction: Pick<ContextCompactionService, 'compactBeforeSampling' | 'compactAfterOverflow' | 'canCompact' | 'compactAfterRun'>
  classifyError: ClassifyHostError
  aiErrorMessage: (error: LLMError) => string
  assertConversationExists: (conversationId: string) => Promise<void>
  /** 同一个事务里写消息并把附件绑到它上面；附件不属于当前用户、已发出过或已删除时整体失败，不留下消息。 */
  createUserMessage: (conversationId: string, content: string, attachmentIds: string[]) => Promise<StoredMessage>
  /** 提交已确认、Run 已创建后才读取模型输入；存储故障不能倒退用户消息的持久状态。 */
  loadUserMessage: (message: StoredMessage) => Promise<StoredUserMessage>
  prepareToolBatch: (input: { runId: string, samplingAttemptId: string, calls: UnvalidatedToolCallEnvelope[], argumentsTruncated: boolean }, deadline: OperationDeadline) => Promise<MessageInputItem | undefined>
  toolProgress: (rawArgumentsJson: string, toolName: string) => Pick<ToolDisplay, 'workspace'> & { query?: string, url?: string }
  invokeTool: (call: UnvalidatedToolCallEnvelope, context: { runId: string, conversationId: string, signal: AbortSignal, databaseDeadline: OperationDeadline, argumentsTruncated: boolean }) => Promise<ToolInvocationResult & {
    finishStep: (id: string, deadline: OperationDeadline, close: StepClose & { errorMessage?: string }) => Promise<void>
  }>
  releaseRun: (runId: string) => Promise<void>
}

export function toPersistedModelUsage(usage: ModelUsage | null): JsonObject | null {
  return usage ? Object.fromEntries(Object.entries(usage).filter(([, value]) => value !== undefined)) : null
}
