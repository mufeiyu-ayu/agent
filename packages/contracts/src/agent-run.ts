export type AgentRunStatus
  = | 'RUNNING'
    | 'COMPLETED'
    | 'FAILED'
    | 'ABORTED'

export type AgentStepStatus
  = | 'PENDING'
    | 'RUNNING'
    | 'COMPLETED'
    | 'FAILED'
    | 'ABORTED'

export type AgentStepJsonValue
  = | string
    | number
    | boolean
    | null
    | AgentStepJsonValue[]
    | { [key: string]: AgentStepJsonValue }

export interface AgentRun {
  id: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  status: AgentRunStatus
  startedAt: string
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AgentStep {
  id: string
  runId: string
  type: string
  title: string
  status: AgentStepStatus
  input: AgentStepJsonValue | null
  output: AgentStepJsonValue | null
  errorMessage: string | null
  startedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
}
