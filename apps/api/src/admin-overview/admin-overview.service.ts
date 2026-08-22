import type {
  AdminOverviewDailyPoint,
  AdminOverviewStats,
  AdminProviderBalance,
  AgentRunStatus,
} from '@agent/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { readNonNegativeInteger, readObject } from '../admin-runs/admin-run.projector.js'
import { LLMRuntimeConfigService } from '../llm/llm-runtime-config.js'
import { PrismaService } from '../prisma/prisma.service.js'

const WINDOW_DAYS = 30
const DAY_MS = 86_400_000
const SHANGHAI_OFFSET_MS = 8 * 3_600_000
const BALANCE_TIMEOUT_MS = 5_000

const UNAVAILABLE_BALANCE: AdminProviderBalance = {
  available: false,
  currency: null,
  totalBalance: null,
}

@Injectable()
export class AdminOverviewService {
  private readonly logger = new Logger(AdminOverviewService.name)

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(LLMRuntimeConfigService)
    private readonly llmRuntimeConfigService: LLMRuntimeConfigService,
  ) {}

  async getStats(): Promise<AdminOverviewStats> {
    const windowStart = resolveWindowStart()

    // ponytail: usage 存在 AgentStep.output JSON 中，没有统计表；学习阶段单人使用，
    // 应用层扫描 30 天窗口内的 step 即可。数据量大后升级为物化统计表或 raw SQL。
    const [
      conversationCount,
      runCount,
      messageCount,
      statusGroups,
      windowRuns,
      samplingSteps,
      toolSteps,
    ] = await Promise.all([
      this.prismaService.conversation.count(),
      this.prismaService.agentRun.count(),
      this.prismaService.message.count(),
      this.prismaService.agentRun.groupBy({
        by: ['status'],
        // 与模型 / 工具分布同窗口，三张分布图口径一致。
        where: { createdAt: { gte: windowStart } },
        _count: { _all: true },
      }),
      this.prismaService.agentRun.findMany({
        where: { createdAt: { gte: windowStart } },
        select: { createdAt: true },
      }),
      this.prismaService.agentStep.findMany({
        where: {
          type: 'model_sampling',
          createdAt: { gte: windowStart },
        },
        select: { input: true, output: true, createdAt: true },
      }),
      this.prismaService.agentStep.findMany({
        where: {
          type: 'tool_execution',
          createdAt: { gte: windowStart },
        },
        select: { input: true },
      }),
    ])

    const statusCounts: Record<AgentRunStatus, number> = {
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 0,
      ABORTED: 0,
    }
    for (const group of statusGroups)
      statusCounts[group.status] = group._count._all

    const daily = createEmptyDaily(windowStart)
    const dailyByDate = new Map(daily.map(point => [point.date, point]))

    for (const run of windowRuns) {
      const point = dailyByDate.get(shanghaiDateKey(run.createdAt))
      if (point)
        point.runCount += 1
    }

    // 口径：Token 与模型分布统计 model_sampling 采样用量；
    // grounded finalization 的少量收尾采样暂不计入（升级统计表时一并覆盖）。
    let inputTokens = 0
    let outputTokens = 0
    const models = new Map<string, { samplingCount: number, totalTokens: number }>()

    for (const step of samplingSteps) {
      const output = readObject(step.output)
      const usage = readObject(output?.usage)
      const stepInput = readNonNegativeInteger(usage, 'inputTokens')
      const stepOutput = readNonNegativeInteger(usage, 'outputTokens')
      const stepTotal = readNonNegativeInteger(usage, 'totalTokens')
        ?? (stepInput !== null && stepOutput !== null ? stepInput + stepOutput : null)

      if (stepInput !== null && stepOutput !== null) {
        inputTokens += stepInput
        outputTokens += stepOutput

        const point = dailyByDate.get(shanghaiDateKey(step.createdAt))
        if (point) {
          point.inputTokens += stepInput
          point.outputTokens += stepOutput
        }
      }

      // resolvedModel 落库在 step input.initialContext（output.contextPlan 里没有模型名）。
      const initialContext = readObject(readObject(step.input)?.initialContext)
      const model = readString(initialContext, 'resolvedModel')
      if (model) {
        const entry = models.get(model) ?? { samplingCount: 0, totalTokens: 0 }
        entry.samplingCount += 1
        entry.totalTokens += stepTotal ?? 0
        models.set(model, entry)
      }
    }

    const tools = new Map<string, number>()
    for (const step of toolSteps) {
      const toolName = readString(readObject(step.input), 'toolName')
      if (toolName)
        tools.set(toolName, (tools.get(toolName) ?? 0) + 1)
    }

    return {
      totals: {
        conversationCount,
        runCount,
        messageCount,
        inputTokens,
        outputTokens,
      },
      daily,
      statusCounts,
      models: [...models.entries()]
        .map(([model, entry]) => ({ model, ...entry }))
        .sort((left, right) => right.totalTokens - left.totalTokens),
      tools: [...tools.entries()]
        .map(([tool, count]) => ({ tool, count }))
        .sort((left, right) => right.count - left.count),
      windowDays: WINDOW_DAYS,
    }
  }

  async getBalance(): Promise<AdminProviderBalance> {
    try {
      const { apiKey, baseUrl } = this.llmRuntimeConfigService.value
      const origin = new URL(baseUrl).origin

      const response = await fetch(`${origin}/user/balance`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      })

      if (!response.ok) {
        this.logger.warn(`余额查询失败：上游返回 ${response.status}`)
        return UNAVAILABLE_BALANCE
      }

      return parseProviderBalance(await response.json())
    }
    catch (error) {
      this.logger.warn(`余额查询失败：${error instanceof Error ? error.message : String(error)}`)
      return UNAVAILABLE_BALANCE
    }
  }
}

/** 解析 DeepSeek /user/balance 载荷；结构不符时降级为不可用而不是抛错。 */
export function parseProviderBalance(payload: unknown): AdminProviderBalance {
  const record = readObject(payload)
  if (!record || typeof record.is_available !== 'boolean')
    return UNAVAILABLE_BALANCE

  const info = readObject(Array.isArray(record.balance_infos) ? record.balance_infos[0] : null)

  return {
    available: record.is_available,
    currency: readString(info, 'currency'),
    totalBalance: readString(info, 'total_balance'),
  }
}

/** 统计窗口起点：29 天前的 Asia/Shanghai 零点（含今天共 30 天）。 */
function resolveWindowStart(now = Date.now()): Date {
  const todayStartShanghai = Math.floor((now + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS
  return new Date(todayStartShanghai - (WINDOW_DAYS - 1) * DAY_MS - SHANGHAI_OFFSET_MS)
}

function shanghaiDateKey(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

function createEmptyDaily(windowStart: Date): AdminOverviewDailyPoint[] {
  return Array.from({ length: WINDOW_DAYS }, (_, index) => ({
    date: shanghaiDateKey(new Date(windowStart.getTime() + index * DAY_MS)),
    runCount: 0,
    inputTokens: 0,
    outputTokens: 0,
  }))
}

// 不复用 projector 的 readString：那个版本内嵌 128 字安全截断（preview 语义），
// 统计场景要原值（模型名 / 币种），保留本地纯读取实现。
function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
