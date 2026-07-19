import type {
  AssistantOutputItem,
  DerivedRunLifecycleItem,
  LoadConversationHistoryItem,
  ModelSamplingItem,
  ReceiveUserMessageItem,
  RunDetail,
  RunMessageItem,
  RunStatus,
  RunTimelineItem,
  ToolExecutionItem,
} from './run.model'
import { createSafeRawData, toRunListItem } from './run.utils'

type RunDetailWithoutSafeRawData = Omit<RunDetail, 'safeRawData'>

interface SuccessfulRunConfig {
  id: string
  question: string
  answer: string
  model: string
  startedAt: string
  durationMs: number
  inputTokens: number
  outputTokens: number
  historyMessageCount: number
}

interface ToolRunConfig extends Omit<SuccessfulRunConfig, 'inputTokens' | 'outputTokens'> {
  firstInputTokens: number
  firstOutputTokens: number
  secondInputTokens: number
  secondOutputTokens: number
  toolObservationChars: number
}

export const mockRunDetails: RunDetail[] = [
  createRunningRun(),
  createToolRun({
    id: 'demo_run_tool_20260719_01',
    question: '请查询站内已有文章，并给出 3 个可复用的 SEO 标题方向。',
    answer: '已基于站内文章摘要整理出三个方向：问题导向、结果导向和对比导向，并为每个方向补充了可直接改写的标题结构。',
    model: 'gpt-4o-mini',
    startedAt: '2026-07-19T09:28:12+08:00',
    durationMs: 3_620,
    firstInputTokens: 1_180,
    firstOutputTokens: 42,
    secondInputTokens: 1_350,
    secondOutputTokens: 246,
    historyMessageCount: 5,
    toolObservationChars: 486,
  }),
  createSuccessfulRun({
    id: 'demo_run_answer_20260719_02',
    question: '如何判断一篇产品页的搜索意图是否足够明确？',
    answer: '可以从查询词、页面主张、证据结构和 CTA 四层对齐。先确认页面只服务一个主要意图，再检查标题、首屏和正文是否给出同一个答案。',
    model: 'gpt-4o-mini',
    startedAt: '2026-07-19T08:54:03+08:00',
    durationMs: 2_480,
    inputTokens: 884,
    outputTokens: 318,
    historyMessageCount: 4,
  }),
  createFailedRun(),
  createAbortedRun(),
  createSuccessfulRun({
    id: 'demo_run_answer_20260718_06',
    question: '给我一个技术文档页面的 meta description 检查清单。',
    answer: '检查长度、核心主题、受众收益、与页面正文的一致性，以及是否避免堆叠关键词。最后确认描述本身可独立说明页面价值。',
    model: 'gpt-4.1-mini',
    startedAt: '2026-07-18T16:42:20+08:00',
    durationMs: 2_760,
    inputTokens: 742,
    outputTokens: 274,
    historyMessageCount: 3,
  }),
  createSuccessfulRun({
    id: 'demo_run_answer_20260717_07',
    question: '把这段首页文案改得更具体，但不要增加夸张承诺。',
    answer: '已将抽象优势改成可验证的工作流描述，并保留原有语气，没有加入无法证明的效果或排名承诺。',
    model: 'gpt-4o',
    startedAt: '2026-07-17T11:17:44+08:00',
    durationMs: 3_180,
    inputTokens: 1_124,
    outputTokens: 336,
    historyMessageCount: 8,
  }),
  createToolRun({
    id: 'demo_run_tool_20260716_08',
    question: '站内有没有关于多语言 SEO 的文章？只总结可见的摘要信息。',
    answer: '站内摘要中有两篇相关内容，分别覆盖 hreflang 基础和多语言 URL 规划。这里仅总结了可见摘要，没有读取完整正文。',
    model: 'gpt-4o',
    startedAt: '2026-07-16T14:06:11+08:00',
    durationMs: 4_120,
    firstInputTokens: 1_420,
    firstOutputTokens: 38,
    secondInputTokens: 1_698,
    secondOutputTokens: 226,
    historyMessageCount: 7,
    toolObservationChars: 392,
  }),
]

export const mockRunList = mockRunDetails.map(toRunListItem)

export const mockRunModels = [...new Set(mockRunList.map(run => run.model))]

export function getMockRunDetail(runId: string): RunDetail | undefined {
  return mockRunDetails.find(run => run.id === runId)
}

function createSuccessfulRun(config: SuccessfulRunConfig): RunDetail {
  const userMessageId = `${config.id}:user`
  const assistantMessageId = `${config.id}:assistant`
  const endedAt = addMs(config.startedAt, config.durationMs)
  const samplingDuration = Math.max(600, config.durationMs - 540)
  const timeline: RunTimelineItem[] = [
    lifecycleItem(config.id, 'run_started', config.startedAt, 'RUNNING'),
    receiveMessageItem(config.id, userMessageId, config.question, config.startedAt),
    historyItem(config.id, 2, config.startedAt, config.historyMessageCount),
    modelSamplingItem({
      runId: config.id,
      sequence: 3,
      samplingIndex: 1,
      model: config.model,
      messageCount: config.historyMessageCount + 1,
      toolCount: 1,
      finishReason: 'stop',
      status: 'COMPLETED',
      startedAt: addMs(config.startedAt, 260),
      durationMs: samplingDuration,
      inputTokens: config.inputTokens,
      outputTokens: config.outputTokens,
      textChars: config.answer.length,
      inputSummary: `${config.historyMessageCount + 1} 条安全消息摘要与 1 个工具声明`,
      outputSummary: `生成 ${config.answer.length} 字符的最终回答，finishReason=stop`,
    }),
    assistantOutputItem(
      config.id,
      4,
      assistantMessageId,
      config.answer,
      addMs(config.startedAt, 420),
      Math.max(120, config.durationMs - 580),
    ),
    lifecycleItem(config.id, 'run_completed', endedAt, 'COMPLETED'),
  ]

  return finalizeRun({
    ...baseRun(config, 'COMPLETED', config.durationMs),
    toolCallCount: 0,
    samplingCount: 1,
    inputTokens: config.inputTokens,
    outputTokens: config.outputTokens,
    totalTokens: config.inputTokens + config.outputTokens,
    conversationId: `${config.id}:conversation`,
    userMessageId,
    assistantMessageId,
    updatedAt: endedAt,
    timeline,
    messages: messageTranscript(
      userMessageId,
      assistantMessageId,
      config.question,
      config.answer,
      config.startedAt,
      addMs(endedAt, -200),
      'COMPLETED',
    ),
  })
}

function createToolRun(config: ToolRunConfig): RunDetail {
  const userMessageId = `${config.id}:user`
  const assistantMessageId = `${config.id}:assistant`
  const endedAt = addMs(config.startedAt, config.durationMs)
  const secondSamplingDuration = Math.max(700, config.durationMs - 1_850)
  const inputTokens = config.firstInputTokens + config.secondInputTokens
  const outputTokens = config.firstOutputTokens + config.secondOutputTokens
  const timeline: RunTimelineItem[] = [
    lifecycleItem(config.id, 'run_started', config.startedAt, 'RUNNING'),
    receiveMessageItem(config.id, userMessageId, config.question, config.startedAt),
    historyItem(config.id, 2, config.startedAt, config.historyMessageCount),
    modelSamplingItem({
      runId: config.id,
      sequence: 3,
      samplingIndex: 1,
      model: config.model,
      messageCount: config.historyMessageCount + 1,
      toolCount: 1,
      finishReason: 'tool_calls',
      status: 'COMPLETED',
      startedAt: addMs(config.startedAt, 300),
      durationMs: 680,
      inputTokens: config.firstInputTokens,
      outputTokens: config.firstOutputTokens,
      textChars: 0,
      inputSummary: `${config.historyMessageCount + 1} 条安全消息摘要与 1 个工具声明`,
      outputSummary: '请求调用 search_articles；未保留完整参数或隐藏推理',
    }),
    toolExecutionItem(
      config.id,
      config.startedAt,
      config.toolObservationChars,
    ),
    modelSamplingItem({
      runId: config.id,
      sequence: 5,
      samplingIndex: 2,
      model: config.model,
      messageCount: config.historyMessageCount + 3,
      toolCount: 1,
      finishReason: 'stop',
      status: 'COMPLETED',
      startedAt: addMs(config.startedAt, 1_550),
      durationMs: secondSamplingDuration,
      inputTokens: config.secondInputTokens,
      outputTokens: config.secondOutputTokens,
      textChars: config.answer.length,
      inputSummary: '加入 1 条 Tool Call 与 1 条安全 Observation 摘要后的模型输入',
      outputSummary: `生成 ${config.answer.length} 字符的最终回答，finishReason=stop`,
    }),
    assistantOutputItem(
      config.id,
      6,
      assistantMessageId,
      config.answer,
      addMs(config.startedAt, 1_700),
      Math.max(120, config.durationMs - 1_860),
    ),
    lifecycleItem(config.id, 'run_completed', endedAt, 'COMPLETED'),
  ]

  return finalizeRun({
    ...baseRun(config, 'COMPLETED', config.durationMs),
    toolCallCount: 1,
    samplingCount: 2,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    conversationId: `${config.id}:conversation`,
    userMessageId,
    assistantMessageId,
    updatedAt: endedAt,
    timeline,
    messages: messageTranscript(
      userMessageId,
      assistantMessageId,
      config.question,
      config.answer,
      config.startedAt,
      addMs(endedAt, -200),
      'COMPLETED',
    ),
  })
}

function createFailedRun(): RunDetail {
  const config = {
    id: 'demo_run_failed_20260719_03',
    question: '请分析这批页面为什么没有获得稳定的自然搜索流量。',
    model: 'gpt-4.1-mini',
    startedAt: '2026-07-19T07:46:31+08:00',
    durationMs: 1_890,
  }
  const userMessageId = `${config.id}:user`
  const assistantMessageId = `${config.id}:assistant`
  const endedAt = addMs(config.startedAt, config.durationMs)
  const fallback = '模型服务暂时没有返回结果，请稍后重试。'
  const timeline: RunTimelineItem[] = [
    lifecycleItem(config.id, 'run_started', config.startedAt, 'RUNNING'),
    receiveMessageItem(config.id, userMessageId, config.question, config.startedAt),
    historyItem(config.id, 2, config.startedAt, 6),
    modelSamplingItem({
      runId: config.id,
      sequence: 3,
      samplingIndex: 1,
      model: config.model,
      messageCount: 7,
      toolCount: 1,
      finishReason: null,
      status: 'FAILED',
      startedAt: addMs(config.startedAt, 260),
      durationMs: 1_550,
      inputTokens: null,
      outputTokens: null,
      textChars: 0,
      inputSummary: '7 条安全消息摘要与 1 个工具声明',
      outputSummary: 'Provider 响应未完成；仅保留安全错误摘要',
    }),
    lifecycleItem(config.id, 'run_failed', endedAt, 'FAILED'),
  ]

  return finalizeRun({
    id: config.id,
    questionPreview: config.question,
    status: 'FAILED',
    model: config.model,
    toolCallCount: 0,
    samplingCount: 1,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    durationMs: config.durationMs,
    startedAt: config.startedAt,
    endedAt,
    createdAt: config.startedAt,
    conversationId: `${config.id}:conversation`,
    userMessageId,
    assistantMessageId,
    updatedAt: endedAt,
    timeline,
    messages: messageTranscript(
      userMessageId,
      assistantMessageId,
      config.question,
      fallback,
      config.startedAt,
      addMs(endedAt, -40),
      'FAILED',
    ),
  })
}

function createAbortedRun(): RunDetail {
  const config = {
    id: 'demo_run_aborted_20260718_04',
    question: '生成一份覆盖所有产品页面的完整 SEO 审计报告。',
    model: 'gpt-4o-mini',
    startedAt: '2026-07-18T18:11:06+08:00',
    durationMs: 1_360,
  }
  const userMessageId = `${config.id}:user`
  const assistantMessageId = `${config.id}:assistant`
  const endedAt = addMs(config.startedAt, config.durationMs)
  const partialAnswer = '我会先按页面类型整理检查维度，然后…'
  const timeline: RunTimelineItem[] = [
    lifecycleItem(config.id, 'run_started', config.startedAt, 'RUNNING'),
    receiveMessageItem(config.id, userMessageId, config.question, config.startedAt),
    historyItem(config.id, 2, config.startedAt, 2),
    modelSamplingItem({
      runId: config.id,
      sequence: 3,
      samplingIndex: 1,
      model: config.model,
      messageCount: 3,
      toolCount: 1,
      finishReason: null,
      status: 'ABORTED',
      startedAt: addMs(config.startedAt, 260),
      durationMs: 1_100,
      inputTokens: null,
      outputTokens: null,
      textChars: partialAnswer.length,
      inputSummary: '3 条安全消息摘要与 1 个工具声明',
      outputSummary: `用户中断前生成 ${partialAnswer.length} 字符的可见片段`,
    }),
    assistantOutputItem(
      config.id,
      4,
      assistantMessageId,
      null,
      addMs(config.startedAt, 420),
      config.durationMs - 420,
      'ABORTED',
    ),
    lifecycleItem(config.id, 'run_aborted', endedAt, 'ABORTED'),
  ]

  return finalizeRun({
    id: config.id,
    questionPreview: config.question,
    status: 'ABORTED',
    model: config.model,
    toolCallCount: 0,
    samplingCount: 1,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    durationMs: config.durationMs,
    startedAt: config.startedAt,
    endedAt,
    createdAt: config.startedAt,
    conversationId: `${config.id}:conversation`,
    userMessageId,
    assistantMessageId,
    updatedAt: endedAt,
    timeline,
    messages: messageTranscript(
      userMessageId,
      assistantMessageId,
      config.question,
      partialAnswer,
      config.startedAt,
      addMs(endedAt, -40),
      'ABORTED',
    ),
  })
}

function createRunningRun(): RunDetail {
  const config = {
    id: 'demo_run_running_20260719_05',
    question: '比较站内两种文章结构，并给出更适合产品教育内容的方案。',
    model: 'gpt-4o-mini',
    startedAt: '2026-07-19T10:05:22+08:00',
  }
  const userMessageId = `${config.id}:user`
  const assistantMessageId = `${config.id}:assistant`
  const partialAnswer = '正在比较两种结构的阅读路径…'
  const runningSampling = modelSamplingItem({
    runId: config.id,
    sequence: 3,
    samplingIndex: 1,
    model: config.model,
    messageCount: 5,
    toolCount: 1,
    finishReason: null,
    status: 'RUNNING',
    startedAt: addMs(config.startedAt, 260),
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    textChars: partialAnswer.length,
    inputSummary: '5 条安全消息摘要与 1 个工具声明',
    outputSummary: 'Sampling 仍在进行，最终 finish reason 与 usage 尚不可用',
  })
  const timeline: RunTimelineItem[] = [
    lifecycleItem(config.id, 'run_started', config.startedAt, 'RUNNING'),
    receiveMessageItem(config.id, userMessageId, config.question, config.startedAt),
    historyItem(config.id, 2, config.startedAt, 4),
    runningSampling,
    assistantOutputItem(
      config.id,
      4,
      assistantMessageId,
      null,
      addMs(config.startedAt, 420),
      null,
      'RUNNING',
    ),
  ]

  return finalizeRun({
    id: config.id,
    questionPreview: config.question,
    status: 'RUNNING',
    model: config.model,
    toolCallCount: 0,
    samplingCount: 1,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    durationMs: null,
    startedAt: config.startedAt,
    endedAt: null,
    createdAt: config.startedAt,
    conversationId: `${config.id}:conversation`,
    userMessageId,
    assistantMessageId,
    updatedAt: addMs(config.startedAt, 2_400),
    timeline,
    messages: messageTranscript(
      userMessageId,
      assistantMessageId,
      config.question,
      partialAnswer,
      config.startedAt,
      addMs(config.startedAt, 1_100),
      'STREAMING',
    ),
  })
}

function baseRun(
  config: SuccessfulRunConfig | ToolRunConfig,
  status: RunStatus,
  durationMs: number,
) {
  return {
    id: config.id,
    questionPreview: config.question,
    status,
    model: config.model,
    durationMs,
    startedAt: config.startedAt,
    endedAt: addMs(config.startedAt, durationMs),
    createdAt: config.startedAt,
  }
}

function finalizeRun(run: RunDetailWithoutSafeRawData): RunDetail {
  return {
    ...run,
    safeRawData: createSafeRawData(run),
  }
}

function receiveMessageItem(
  runId: string,
  messageId: string,
  content: string,
  runStartedAt: string,
): ReceiveUserMessageItem {
  const startedAt = addMs(runStartedAt, 20)

  return {
    ...durableStep(runId, 1, '接收用户消息', 'COMPLETED', startedAt, 70),
    type: 'receive_user_message',
    messageId,
    contentPreview: content,
    contentLength: content.length,
    createdAt: runStartedAt,
  }
}

function historyItem(
  runId: string,
  sequence: number,
  runStartedAt: string,
  messageCount: number,
): LoadConversationHistoryItem {
  return {
    ...durableStep(
      runId,
      sequence,
      '加载会话上下文',
      'COMPLETED',
      addMs(runStartedAt, 110),
      120,
    ),
    type: 'load_conversation_history',
    historyLimit: 20,
    messageCount,
    truncated: false,
  }
}

function modelSamplingItem(input: {
  runId: string
  sequence: number
  samplingIndex: number
  model: string
  messageCount: number
  toolCount: number
  finishReason: ModelSamplingItem['finishReason']
  status: ModelSamplingItem['status']
  startedAt: string
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  textChars: number
  inputSummary: string
  outputSummary: string
}): ModelSamplingItem {
  return {
    ...durableStep(
      input.runId,
      input.sequence,
      `模型采样 #${input.samplingIndex}`,
      input.status,
      input.startedAt,
      input.durationMs,
    ),
    type: 'model_sampling',
    samplingIndex: input.samplingIndex,
    samplingAttemptId: `${input.runId}:sampling-${input.samplingIndex}`,
    requestedModel: input.model,
    messageCount: input.messageCount,
    toolCount: input.toolCount,
    finishReason: input.finishReason,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.inputTokens === null || input.outputTokens === null
      ? null
      : input.inputTokens + input.outputTokens,
    textChars: input.textChars,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
  }
}

function toolExecutionItem(
  runId: string,
  runStartedAt: string,
  observationChars: number,
): ToolExecutionItem {
  return {
    ...durableStep(
      runId,
      4,
      '执行工具',
      'COMPLETED',
      addMs(runStartedAt, 1_050),
      430,
    ),
    type: 'tool_execution',
    callId: `${runId}:call-1`,
    toolName: 'search_articles',
    toolVersion: '1.0.0',
    samplingAttemptId: `${runId}:sampling-1`,
    executionAttempt: 1,
    validation: 'accepted',
    ok: true,
    code: null,
    retryable: null,
    rawArgumentsChars: 54,
    observationChars,
    truncated: false,
    inputSummary: '只读文章查询；完整参数未写入 durable Step',
    outputSummary: `返回安全 Observation 摘要（${observationChars} 字符）；完整 Tool Result 未持久化`,
  }
}

function assistantOutputItem(
  runId: string,
  sequence: number,
  assistantMessageId: string,
  content: string | null,
  startedAt: string,
  durationMs: number | null,
  status: AssistantOutputItem['status'] = 'COMPLETED',
): AssistantOutputItem {
  return {
    ...durableStep(
      runId,
      sequence,
      '生成助手回复',
      status,
      startedAt,
      durationMs,
    ),
    type: 'assistant_output',
    assistantMessageId,
    contentLength: content?.length ?? null,
    contentPreview: content,
    completedAt: status === 'COMPLETED' && durationMs !== null
      ? addMs(startedAt, durationMs)
      : null,
  }
}

function lifecycleItem(
  runId: string,
  event: DerivedRunLifecycleItem['event'],
  at: string,
  status: DerivedRunLifecycleItem['status'],
): DerivedRunLifecycleItem {
  const labels: Record<DerivedRunLifecycleItem['event'], string> = {
    run_started: 'Run Started',
    run_completed: 'Run Completed',
    run_failed: 'Run Failed',
    run_aborted: 'Run Aborted',
  }

  return {
    id: `${runId}:${event}`,
    kind: 'derived_lifecycle',
    type: 'run_lifecycle',
    event,
    title: labels[event],
    status,
    sequence: null,
    startedAt: at,
    endedAt: event === 'run_started' ? null : at,
    durationMs: 0,
    summary: '由 AgentRun 状态与时间推导的 UI 生命周期节点，不是 durable AgentStep。',
  }
}

function durableStep(
  runId: string,
  sequence: number,
  title: string,
  status: ModelSamplingItem['status'],
  startedAt: string,
  durationMs: number | null,
) {
  return {
    id: `${runId}:step-${sequence}`,
    kind: 'durable_step' as const,
    title,
    status,
    sequence,
    startedAt,
    endedAt: durationMs === null ? null : addMs(startedAt, durationMs),
    durationMs,
  }
}

function messageTranscript(
  userMessageId: string,
  assistantMessageId: string,
  question: string,
  answer: string,
  startedAt: string,
  assistantAt: string,
  assistantStatus: RunMessageItem['status'],
): RunMessageItem[] {
  return [
    {
      id: userMessageId,
      role: 'USER',
      status: 'COMPLETED',
      contentPreview: question,
      createdAt: startedAt,
      updatedAt: startedAt,
    },
    {
      id: assistantMessageId,
      role: 'ASSISTANT',
      status: assistantStatus,
      contentPreview: answer,
      createdAt: addMs(startedAt, 240),
      updatedAt: assistantAt,
    },
  ]
}

function addMs(value: string, milliseconds: number): string {
  return new Date(new Date(value).getTime() + milliseconds).toISOString()
}
