import type { LlmProviderFamily } from '@agent/contracts'

export type OverviewWindowKey = '24h' | '7d' | '30d'

export interface OverviewModelUsageItem {
  id: string
  displayName: string
  wireName: string
  providerFamily: LlmProviderFamily
  providerNote: string
  callCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  percent: number
  lastProbeOk: boolean
  avgLatencyMs: number
  issueDate: string
  contact: string
}

export interface OverviewProviderBalanceItem {
  id: string
  family: LlmProviderFamily
  note: string
  currency: string
  balance: string
  available: boolean
  updatedAt: string
}

export interface OverviewKpiStats {
  runCount: number
  completedRuns: number
  failedRuns: number
  abortedRuns: number
  successRate: number
  conversationCount: number
  messageCount: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  avgTokensPerRun: number
  totalProviders: number
  activeProviders: number
  healthyProviders: number
  totalModels: number
  visibleModels: number
  toolCallCount: number
  avgToolCallsPerRun: number
}

export interface OverviewTrendPoint {
  time: string
  runCount: number
  inputTokens: number
  outputTokens: number
  modelTokens: Record<string, number>
}

export interface OverviewToolItem {
  name: string
  count: number
  percent: number
  category: string
  amountText: string
  color: string
}

export interface OverviewSparklines {
  heartbeat: number[]
  sparkline: number[]
  balanceBars: { height: number, color: string }[]
}

export interface OverviewDataSet {
  window: OverviewWindowKey
  kpi: OverviewKpiStats
  balances: OverviewProviderBalanceItem[]
  models: OverviewModelUsageItem[]
  trends: OverviewTrendPoint[]
  tools: OverviewToolItem[]
  sparklines: OverviewSparklines
  statusCounts: {
    COMPLETED: number
    FAILED: number
    ABORTED: number
    RUNNING: number
  }
}

export const OVERVIEW_MOCK_BALANCES: OverviewProviderBalanceItem[] = [
  {
    id: 'p-deepseek',
    family: 'deepseek',
    note: 'DeepSeek 官方 API',
    currency: 'CNY',
    balance: '23.88',
    available: true,
    updatedAt: '1 分钟前',
  },
  {
    id: 'p-openai',
    family: 'openai',
    note: 'OpenAI 商业账号',
    currency: 'USD',
    balance: '15.50',
    available: true,
    updatedAt: '10 分钟前',
  },
  {
    id: 'p-claude',
    family: 'claude',
    note: 'Anthropic 中转通道',
    currency: 'USD',
    balance: '42.10',
    available: true,
    updatedAt: '5 分钟前',
  },
  {
    id: 'p-gemini',
    family: 'gemini',
    note: 'Google AI Studio',
    currency: 'USD',
    balance: 'Free Tier',
    available: true,
    updatedAt: '实时有效',
  },
]

const MOCK_MODELS: OverviewModelUsageItem[] = [
  {
    id: 'm-gpt4o',
    displayName: 'GPT-4o (Omni)',
    wireName: 'gpt-4o-2024-11-20',
    providerFamily: 'openai',
    providerNote: 'OpenAI 官方通道',
    callCount: 72,
    inputTokens: 482400,
    outputTokens: 144200,
    totalTokens: 626600,
    percent: 42.2,
    lastProbeOk: true,
    avgLatencyMs: 1450,
    issueDate: '09/20/26',
    contact: 'api-prod-cluster-1',
  },
  {
    id: 'm-ds-reasoner',
    displayName: 'DeepSeek R1',
    wireName: 'deepseek-reasoner',
    providerFamily: 'deepseek',
    providerNote: 'DeepSeek 官方 API',
    callCount: 42,
    inputTokens: 268000,
    outputTokens: 86400,
    totalTokens: 354400,
    percent: 23.9,
    lastProbeOk: true,
    avgLatencyMs: 3720,
    issueDate: '09/19/26',
    contact: 'deepseek-main-key',
  },
  {
    id: 'm-claude-sonnet',
    displayName: 'Claude 3.5 Sonnet',
    wireName: 'claude-3-5-sonnet-20241022',
    providerFamily: 'claude',
    providerNote: 'Anthropic 中转通道',
    callCount: 28,
    inputTokens: 158200,
    outputTokens: 41800,
    totalTokens: 200000,
    percent: 13.5,
    lastProbeOk: true,
    avgLatencyMs: 1890,
    issueDate: '09/18/26',
    contact: 'anthropic-relay-hk',
  },
  {
    id: 'm-ds-chat',
    displayName: 'DeepSeek V3',
    wireName: 'deepseek-chat',
    providerFamily: 'deepseek',
    providerNote: 'DeepSeek 官方 API',
    callCount: 22,
    inputTokens: 112000,
    outputTokens: 32000,
    totalTokens: 144000,
    percent: 9.7,
    lastProbeOk: true,
    avgLatencyMs: 980,
    issueDate: '09/17/26',
    contact: 'deepseek-main-key',
  },
  {
    id: 'm-gemini-pro',
    displayName: 'Gemini 1.5 Pro',
    wireName: 'gemini-1.5-pro-latest',
    providerFamily: 'gemini',
    providerNote: 'Google AI Studio',
    callCount: 12,
    inputTokens: 64200,
    outputTokens: 18400,
    totalTokens: 82600,
    percent: 5.6,
    lastProbeOk: true,
    avgLatencyMs: 1280,
    issueDate: '09/16/26',
    contact: 'google-studio-dev',
  },
  {
    id: 'm-gpt4o-mini',
    displayName: 'GPT-4o Mini',
    wireName: 'gpt-4o-mini',
    providerFamily: 'openai',
    providerNote: 'OpenAI 官方通道',
    callCount: 8,
    inputTokens: 58000,
    outputTokens: 20000,
    totalTokens: 78000,
    percent: 5.1,
    lastProbeOk: true,
    avgLatencyMs: 640,
    issueDate: '09/15/26',
    contact: 'api-prod-cluster-1',
  },
  {
    id: 'm-claude-haiku',
    displayName: 'Claude 3.5 Haiku',
    wireName: 'claude-3-5-haiku-20241022',
    providerFamily: 'claude',
    providerNote: 'Anthropic 中转通道',
    callCount: 5,
    inputTokens: 32000,
    outputTokens: 9200,
    totalTokens: 41200,
    percent: 2.8,
    lastProbeOk: true,
    avgLatencyMs: 720,
    issueDate: '09/14/26',
    contact: 'anthropic-relay-hk',
  },
  {
    id: 'm-gemini-flash',
    displayName: 'Gemini 1.5 Flash',
    wireName: 'gemini-1.5-flash-latest',
    providerFamily: 'gemini',
    providerNote: 'Google AI Studio',
    callCount: 4,
    inputTokens: 24000,
    outputTokens: 6800,
    totalTokens: 30800,
    percent: 2.1,
    lastProbeOk: true,
    avgLatencyMs: 510,
    issueDate: '09/13/26',
    contact: 'google-studio-dev',
  },
]

const MOCK_DATA_24H: OverviewDataSet = {
  window: '24h',
  kpi: {
    runCount: 38,
    completedRuns: 36,
    failedRuns: 1,
    abortedRuns: 1,
    successRate: 94.7,
    conversationCount: 14,
    messageCount: 82,
    totalTokens: 312450,
    inputTokens: 241100,
    outputTokens: 71350,
    avgTokensPerRun: 8222,
    totalProviders: 4,
    activeProviders: 4,
    healthyProviders: 4,
    totalModels: 8,
    visibleModels: 6,
    toolCallCount: 96,
    avgToolCallsPerRun: 2.5,
  },
  balances: OVERVIEW_MOCK_BALANCES,
  models: MOCK_MODELS,
  trends: [
    { time: '11:00', runCount: 3, inputTokens: 18500, outputTokens: 5200, modelTokens: { 'GPT-4o': 14200, 'DeepSeek R1': 9500 } },
    { time: '12:00', runCount: 5, inputTokens: 32000, outputTokens: 8900, modelTokens: { 'GPT-4o': 22000, 'Claude 3.5': 18900 } },
    { time: '13:00', runCount: 2, inputTokens: 12400, outputTokens: 3100, modelTokens: { 'GPT-4o': 9500, 'DeepSeek V3': 6000 } },
    { time: '14:00', runCount: 8, inputTokens: 54000, outputTokens: 15600, modelTokens: { 'GPT-4o': 38000, 'DeepSeek R1': 31600 } },
    { time: '15:00', runCount: 6, inputTokens: 41200, outputTokens: 11800, modelTokens: { 'Claude 3.5': 28000, 'Gemini 1.5': 25000 } },
    { time: '16:00', runCount: 4, inputTokens: 26000, outputTokens: 7400, modelTokens: { 'GPT-4o': 18400, 'GPT-4o Mini': 15000 } },
    { time: '17:00', runCount: 7, inputTokens: 48500, outputTokens: 13900, modelTokens: { 'GPT-4o': 34000, 'DeepSeek R1': 28400 } },
    { time: '18:00', runCount: 3, inputTokens: 21000, outputTokens: 6100, modelTokens: { 'DeepSeek V3': 15100, 'Claude 3.5': 12000 } },
    { time: '19:00', runCount: 1, inputTokens: 7200, outputTokens: 2100, modelTokens: { 'GPT-4o': 9300 } },
    { time: '20:00', runCount: 2, inputTokens: 13500, outputTokens: 3800, modelTokens: { 'DeepSeek R1': 17300 } },
    { time: '21:00', runCount: 4, inputTokens: 28000, outputTokens: 7900, modelTokens: { 'GPT-4o': 21900, 'Claude 3.5': 14000 } },
    { time: '22:00', runCount: 2, inputTokens: 14000, outputTokens: 4100, modelTokens: { 'GPT-4o': 18100 } },
    { time: '23:00', runCount: 0, inputTokens: 0, outputTokens: 0, modelTokens: {} },
    { time: '00:00', runCount: 0, inputTokens: 0, outputTokens: 0, modelTokens: {} },
    { time: '01:00', runCount: 0, inputTokens: 0, outputTokens: 0, modelTokens: {} },
    { time: '02:00', runCount: 1, inputTokens: 6800, outputTokens: 1900, modelTokens: { 'DeepSeek V3': 8700 } },
    { time: '03:00', runCount: 0, inputTokens: 0, outputTokens: 0, modelTokens: {} },
    { time: '04:00', runCount: 0, inputTokens: 0, outputTokens: 0, modelTokens: {} },
    { time: '05:00', runCount: 0, inputTokens: 0, outputTokens: 0, modelTokens: {} },
    { time: '06:00', runCount: 1, inputTokens: 7400, outputTokens: 2100, modelTokens: { 'GPT-4o': 9500 } },
    { time: '07:00', runCount: 3, inputTokens: 19500, outputTokens: 5400, modelTokens: { 'GPT-4o': 14900, 'Claude 3.5': 10000 } },
    { time: '08:00', runCount: 6, inputTokens: 42000, outputTokens: 12200, modelTokens: { 'GPT-4o': 29200, 'DeepSeek R1': 25000 } },
    { time: '09:00', runCount: 9, inputTokens: 61500, outputTokens: 17400, modelTokens: { 'GPT-4o': 44900, 'DeepSeek R1': 34000 } },
    { time: '10:00', runCount: 7, inputTokens: 48000, outputTokens: 13600, modelTokens: { 'Claude 3.5': 32600, 'Gemini 1.5': 29000 } },
  ],
  tools: [
    { name: 'retrieve_article_context', count: 48, percent: 50.0, category: 'RAG 检索', amountText: '$4.80', color: '#10b981' },
    { name: 'search_articles', count: 32, percent: 33.3, category: '语义搜索', amountText: '$3.20', color: '#3b82f6' },
    { name: 'get_article_detail', count: 12, percent: 12.5, category: '内容读取', amountText: '$1.20', color: '#f59e0b' },
    { name: 'web_fetch', count: 4, percent: 4.2, category: '网络抓取', amountText: '$0.40', color: '#ec4899' },
  ],
  sparklines: {
    heartbeat: [12, 14, 10, 16, 18, 15, 14, 17, 19, 16, 18, 20, 18, 19, 20, 18],
    sparkline: [10, 12, 14, 11, 15, 18, 16, 19, 22, 20, 24],
    balanceBars: [
      { height: 18, color: '#10b981' },
      { height: 24, color: '#10b981' },
      { height: 14, color: '#f43f5e' },
      { height: 28, color: '#10b981' },
      { height: 22, color: '#10b981' },
      { height: 16, color: '#f43f5e' },
      { height: 26, color: '#10b981' },
      { height: 32, color: '#10b981' },
      { height: 20, color: '#f43f5e' },
      { height: 30, color: '#10b981' },
      { height: 35, color: '#10b981' },
      { height: 28, color: '#10b981' },
    ],
  },
  statusCounts: {
    COMPLETED: 36,
    FAILED: 1,
    ABORTED: 1,
    RUNNING: 0,
  },
}

const MOCK_DATA_7D: OverviewDataSet = {
  window: '7d',
  kpi: {
    runCount: 184,
    completedRuns: 173,
    failedRuns: 6,
    abortedRuns: 5,
    successRate: 94.0,
    conversationCount: 58,
    messageCount: 392,
    totalTokens: 1485600,
    inputTokens: 1142800,
    outputTokens: 342800,
    avgTokensPerRun: 8073,
    totalProviders: 4,
    activeProviders: 4,
    healthyProviders: 4,
    totalModels: 8,
    visibleModels: 6,
    toolCallCount: 462,
    avgToolCallsPerRun: 2.51,
  },
  balances: OVERVIEW_MOCK_BALANCES,
  models: MOCK_MODELS,
  trends: [
    { time: '09-16', runCount: 14, inputTokens: 92000, outputTokens: 28000, modelTokens: { 'GPT-4o': 62000, 'DeepSeek R1': 38000, 'Claude 3.5': 20000 } },
    { time: '09-17', runCount: 22, inputTokens: 146000, outputTokens: 44000, modelTokens: { 'GPT-4o': 98000, 'DeepSeek R1': 54000, 'Claude 3.5': 38000 } },
    { time: '09-18', runCount: 28, inputTokens: 178000, outputTokens: 53000, modelTokens: { 'GPT-4o': 118000, 'DeepSeek R1': 68000, 'Gemini 1.5': 45000 } },
    { time: '09-19', runCount: 32, inputTokens: 210000, outputTokens: 62000, modelTokens: { 'GPT-4o': 136000, 'DeepSeek R1': 74000, 'Claude 3.5': 62000 } },
    { time: '09-20', runCount: 25, inputTokens: 165000, outputTokens: 49000, modelTokens: { 'GPT-4o': 105000, 'DeepSeek R1': 61000, 'Claude 3.5': 48000 } },
    { time: '09-21', runCount: 25, inputTokens: 158800, outputTokens: 48800, modelTokens: { 'GPT-4o': 102600, 'DeepSeek R1': 59400, 'Gemini 1.5': 45600 } },
    { time: '09-22', runCount: 38, inputTokens: 193000, outputTokens: 58000, modelTokens: { 'GPT-4o': 135000, 'DeepSeek R1': 70000, 'Claude 3.5': 46000 } },
  ],
  tools: [
    { name: 'retrieve_article_context', count: 236, percent: 51.1, category: 'RAG 检索', amountText: '$23.60', color: '#10b981' },
    { name: 'search_articles', count: 142, percent: 30.7, category: '语义搜索', amountText: '$14.20', color: '#3b82f6' },
    { name: 'get_article_detail', count: 64, percent: 13.9, category: '内容读取', amountText: '$6.40', color: '#f59e0b' },
    { name: 'web_fetch', count: 20, percent: 4.3, category: '网络抓取', amountText: '$2.00', color: '#ec4899' },
  ],
  sparklines: {
    heartbeat: [12, 14, 10, 16, 18, 15, 14, 17, 19, 16, 18, 20, 18, 19, 20, 18],
    sparkline: [10, 12, 14, 11, 15, 18, 16, 19, 22, 20, 24],
    balanceBars: [
      { height: 18, color: '#10b981' },
      { height: 24, color: '#10b981' },
      { height: 14, color: '#f43f5e' },
      { height: 28, color: '#10b981' },
      { height: 22, color: '#10b981' },
      { height: 16, color: '#f43f5e' },
      { height: 26, color: '#10b981' },
      { height: 32, color: '#10b981' },
      { height: 20, color: '#f43f5e' },
      { height: 30, color: '#10b981' },
      { height: 35, color: '#10b981' },
      { height: 28, color: '#10b981' },
    ],
  },
  statusCounts: {
    COMPLETED: 173,
    FAILED: 6,
    ABORTED: 5,
    RUNNING: 0,
  },
}

const MOCK_DATA_30D: OverviewDataSet = {
  window: '30d',
  kpi: {
    runCount: 640,
    completedRuns: 602,
    failedRuns: 21,
    abortedRuns: 17,
    successRate: 94.1,
    conversationCount: 186,
    messageCount: 1420,
    totalTokens: 5240000,
    inputTokens: 4050000,
    outputTokens: 1190000,
    avgTokensPerRun: 8187,
    totalProviders: 4,
    activeProviders: 4,
    healthyProviders: 4,
    totalModels: 8,
    visibleModels: 6,
    toolCallCount: 1680,
    avgToolCallsPerRun: 2.62,
  },
  balances: OVERVIEW_MOCK_BALANCES,
  models: MOCK_MODELS,
  trends: Array.from({ length: 15 }, (_, i) => {
    const day = i * 2 + 1
    const dateStr = `09-${day.toString().padStart(2, '0')}`
    const runCount = 20 + Math.floor(Math.sin(i * 0.8) * 12) + Math.floor(Math.random() * 8)
    const input = runCount * 6200
    const output = runCount * 1800
    return {
      time: dateStr,
      runCount,
      inputTokens: input,
      outputTokens: output,
      modelTokens: {
        'GPT-4o': Math.floor(input * 0.52),
        'DeepSeek R1': Math.floor(input * 0.28),
        'Claude 3.5': Math.floor(input * 0.20),
      },
    }
  }),
  tools: [
    { name: 'retrieve_article_context', count: 856, percent: 51.0, category: 'RAG 检索', amountText: '$85.60', color: '#10b981' },
    { name: 'search_articles', count: 520, percent: 31.0, category: '语义搜索', amountText: '$52.00', color: '#3b82f6' },
    { name: 'get_article_detail', count: 228, percent: 13.6, category: '内容读取', amountText: '$22.80', color: '#f59e0b' },
    { name: 'web_fetch', count: 76, percent: 4.4, category: '网络抓取', amountText: '$7.60', color: '#ec4899' },
  ],
  sparklines: {
    heartbeat: [12, 14, 10, 16, 18, 15, 14, 17, 19, 16, 18, 20, 18, 19, 20, 18],
    sparkline: [10, 12, 14, 11, 15, 18, 16, 19, 22, 20, 24],
    balanceBars: [
      { height: 18, color: '#10b981' },
      { height: 24, color: '#10b981' },
      { height: 14, color: '#f43f5e' },
      { height: 28, color: '#10b981' },
      { height: 22, color: '#10b981' },
      { height: 16, color: '#f43f5e' },
      { height: 26, color: '#10b981' },
      { height: 32, color: '#10b981' },
      { height: 20, color: '#f43f5e' },
      { height: 30, color: '#10b981' },
      { height: 35, color: '#10b981' },
      { height: 28, color: '#10b981' },
    ],
  },
  statusCounts: {
    COMPLETED: 602,
    FAILED: 21,
    ABORTED: 17,
    RUNNING: 0,
  },
}

export function getOverviewMockData(windowKey: OverviewWindowKey): OverviewDataSet {
  switch (windowKey) {
    case '24h':
      return MOCK_DATA_24H
    case '7d':
      return MOCK_DATA_7D
    case '30d':
      return MOCK_DATA_30D
    default:
      return MOCK_DATA_7D
  }
}
