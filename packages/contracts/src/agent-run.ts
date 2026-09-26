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

/**
 * Run 进入 FAILED / ABORTED 时的失败类别，由 runtime 在终态确立后写入 `AgentRun.errorCode`；
 * 成功的 Run 与本字段上线前的旧 Run 为 null。管理台按它聚合与筛选，不解析失败文案。
 */
export const AGENT_RUN_ERROR_CODES = [
  // 用户停止或流消费者提前断开。
  'aborted',
  // Run 超过 runDeadlineMs。
  'deadline',
  // 上游 401 / 403。
  'llm_auth',
  // 上游 402。
  'llm_balance',
  // 上游 429（SDK 重试用尽）。
  'llm_rate_limit',
  // 上游 400 / 422，或模型配置无效。
  'llm_invalid_request',
  // 上游 5xx（SDK 重试用尽）。
  'llm_server',
  // 连接失败、连接重置、请求超时。
  'llm_network',
  // 流不完整或不合协议：缺 finish reason、length / content_filter 截断、未单独归类的 4xx 等。
  'llm_protocol',
  // 必带 Context 超出输入预算，未调用模型。
  'context_overflow',
  // Token 估算器无法完成请求前估算。
  'estimator_failure',
  // 采样轮数或 Tool Call 预算耗尽仍没有最终回答。
  'loop_limit',
  // 数据库、工具执行等其余服务端故障。
  'internal',
] as const

export type AgentRunErrorCode = typeof AGENT_RUN_ERROR_CODES[number]
