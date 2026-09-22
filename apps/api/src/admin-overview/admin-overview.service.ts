import type {
  AdminOverviewBucket,
  AdminOverviewPoint,
  AdminOverviewStats,
  AdminOverviewWindow,
  AdminProviderBalance,
  AgentRunStatus,
} from '@agent/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { readObject, readString } from '../admin-runs/projection/safe-readers.js'
import { projectTokenUsage } from '../admin-runs/projection/sampling-usage.projector.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS

const UNAVAILABLE_BALANCE: AdminProviderBalance = {
  available: false,
  currency: null,
  totalBalance: null,
}

interface ResolvedWindow {
  bucket: AdminOverviewBucket
  /** 数据下界：小时窗口是精确的 now − 24h，日窗口是 N − 1 天前的上海零点。 */
  windowStart: Date
  /** 第一个桶的起点：小时窗口向下取整到整点，所以首桶是半桶。 */
  pointsStart: Date
  bucketCount: number
}

interface CacheAccumulator {
  hitTokens: number | null
  inputTokens: number | null
}

interface ModelAccumulator extends CacheAccumulator {
  samplingCount: number
  totalTokens: number
  durationTotalMs: number
  durationCount: number
}

@Injectable()
export class AdminOverviewService {
  private readonly logger = new Logger(AdminOverviewService.name)

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(LlmModelConfigService)
    private readonly llmModelConfigService: LlmModelConfigService,
    @Inject(LLMService)
    private readonly llmService: LLMService,
  ) {}

  async getStats(window: AdminOverviewWindow, now = new Date()): Promise<AdminOverviewStats> {
    const { bucket, windowStart, pointsStart, bucketCount } = resolveWindow(window, now)

    // ponytail: usage 存在 AgentStep.output JSON 中，没有统计表；学习阶段单人使用，
    // 应用层扫描窗口内的 step 即可。数据量大后升级为物化统计表或 raw SQL。
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
        select: { input: true, output: true, status: true, createdAt: true, startedAt: true, endedAt: true },
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

    const points = createEmptyPoints(bucket, bucketCount, pointsStart)
    const pointByBucket = new Map(points.map(point => [point.bucketStart, point]))

    for (const run of windowRuns) {
      const point = pointByBucket.get(bucketStartOf(bucket, run.createdAt))
      if (point)
        point.runCount += 1
    }

    // 口径：Token 与模型分布统计 model_sampling 采样用量；
    // grounded finalization 的少量收尾采样暂不计入（升级统计表时一并覆盖）。
    let inputTokens = 0
    let outputTokens = 0
    const cache: CacheAccumulator = { hitTokens: null, inputTokens: null }
    const models = new Map<string, ModelAccumulator>()

    for (const step of samplingSteps) {
      // 与 Run Trace 同一份 usage 读取口径（非负安全整数，缺失为 null）。
      const usage = projectTokenUsage(readObject(step.output))
      const stepInput = usage?.inputTokens ?? null
      const stepOutput = usage?.outputTokens ?? null
      const stepTotal = usage?.totalTokens
        ?? (stepInput !== null && stepOutput !== null ? stepInput + stepOutput : null)
      const stepCacheHit = usage?.promptCacheHitTokens ?? null

      if (stepInput !== null && stepOutput !== null) {
        inputTokens += stepInput
        outputTokens += stepOutput

        const point = pointByBucket.get(bucketStartOf(bucket, step.createdAt))
        if (point) {
          point.inputTokens += stepInput
          point.outputTokens += stepOutput
        }
      }

      // 只有报告了缓存字段的采样才进入命中率分子分母，未报告不按 0 处理。
      if (stepInput !== null && stepCacheHit !== null)
        accumulateCache(cache, stepCacheHit, stepInput)

      // resolvedModel 落库在 step input.initialContext（output.contextPlan 里没有模型名）。
      // 统计要原值而不是 128 字 preview，所以不限长。
      const initialContext = readObject(readObject(step.input)?.initialContext)
      const model = readString(initialContext, 'resolvedModel', Number.POSITIVE_INFINITY)
      if (model) {
        const entry = models.get(model) ?? {
          samplingCount: 0,
          totalTokens: 0,
          hitTokens: null,
          inputTokens: null,
          durationTotalMs: 0,
          durationCount: 0,
        }
        entry.samplingCount += 1
        entry.totalTokens += stepTotal ?? 0
        if (stepInput !== null && stepCacheHit !== null)
          accumulateCache(entry, stepCacheHit, stepInput)
        // 失败 / 中断的采样由 recorder 批量补 endedAt，时长不是真实响应时间，只统计成功的。
        if (step.status === 'COMPLETED' && step.startedAt && step.endedAt) {
          entry.durationTotalMs += Math.max(0, step.endedAt.getTime() - step.startedAt.getTime())
          entry.durationCount += 1
        }
        models.set(model, entry)
      }
    }

    const tools = new Map<string, number>()
    for (const step of toolSteps) {
      const toolName = readString(readObject(step.input), 'toolName', Number.POSITIVE_INFINITY)
      if (toolName)
        tools.set(toolName, (tools.get(toolName) ?? 0) + 1)
    }

    return {
      window,
      bucket,
      totals: {
        conversationCount,
        runCount,
        messageCount,
        inputTokens,
        outputTokens,
        cacheHitTokens: cache.hitTokens,
        cacheInputTokens: cache.inputTokens,
      },
      points,
      statusCounts,
      models: [...models.entries()]
        .map(([model, entry]) => ({
          model,
          samplingCount: entry.samplingCount,
          totalTokens: entry.totalTokens,
          cacheHitTokens: entry.hitTokens,
          cacheInputTokens: entry.inputTokens,
          avgDurationMs: entry.durationCount === 0 ? null : Math.round(entry.durationTotalMs / entry.durationCount),
        }))
        .sort((left, right) => right.totalTokens - left.totalTokens),
      tools: [...tools.entries()]
        .map(([tool, count]) => ({ tool, count }))
        .sort((left, right) => right.count - left.count),
    }
  }

  async getBalance(): Promise<AdminProviderBalance> {
    try {
      const provider = await this.llmModelConfigService.resolveBalanceProvider()

      if (!provider)
        return UNAVAILABLE_BALANCE

      // 与前台 /api/llm/balance 同一条路径与 URL 拼法；404 / 形状不符已在 LLMService 归一为 null。
      const balance = await this.llmService.getProviderBalance(provider)

      return balance ? parseProviderBalance(balance) : UNAVAILABLE_BALANCE
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

  // 空串按缺失处理，保持 null 语义。
  return {
    available: record.is_available,
    currency: readString(info, 'currency', Number.POSITIVE_INFINITY) || null,
    totalBalance: readString(info, 'total_balance', Number.POSITIVE_INFINITY) || null,
  }
}

function accumulateCache(target: CacheAccumulator, hitTokens: number, inputTokens: number) {
  target.hitTokens = (target.hitTokens ?? 0) + hitTokens
  target.inputTokens = (target.inputTokens ?? 0) + inputTokens
}

/**
 * 24h：数据取精确的最近 24 小时，按整点分成 25 个桶（首尾各半桶）。
 * 7d / 30d：N − 1 天前的 Asia/Shanghai 零点起，含今天共 N 个日桶。
 */
export function resolveWindow(window: AdminOverviewWindow, now: Date): ResolvedWindow {
  if (window === '24h') {
    const windowStart = new Date(now.getTime() - 24 * HOUR_MS)
    const pointsStart = new Date(Math.floor(windowStart.getTime() / HOUR_MS) * HOUR_MS)
    const currentHourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS
    return {
      bucket: 'hour',
      windowStart,
      pointsStart,
      bucketCount: (currentHourStart - pointsStart.getTime()) / HOUR_MS + 1,
    }
  }
  const bucketCount = window === '7d' ? 7 : 30
  const todayStartShanghai = Math.floor((now.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS
  const windowStart = new Date(todayStartShanghai - (bucketCount - 1) * DAY_MS - SHANGHAI_OFFSET_MS)
  return { bucket: 'day', windowStart, pointsStart: windowStart, bucketCount }
}

/** 时间所属桶的起点 ISO：整点按 UTC 与上海一致；日桶为 Asia/Shanghai 零点。 */
export function bucketStartOf(bucket: AdminOverviewBucket, date: Date): string {
  if (bucket === 'hour')
    return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS).toISOString()
  const dayStartShanghai = Math.floor((date.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS
  return new Date(dayStartShanghai - SHANGHAI_OFFSET_MS).toISOString()
}

/** 小时桶跨日：零点桶用 MM-DD 标出日期分界，其余 HH:00；日桶 MM-DD。 */
function bucketLabel(bucket: AdminOverviewBucket, bucketStart: Date): string {
  const shanghai = new Date(bucketStart.getTime() + SHANGHAI_OFFSET_MS).toISOString()
  if (bucket === 'day')
    return shanghai.slice(5, 10)
  const hour = shanghai.slice(11, 13)
  return hour === '00' ? shanghai.slice(5, 10) : `${hour}:00`
}

function createEmptyPoints(bucket: AdminOverviewBucket, bucketCount: number, pointsStart: Date): AdminOverviewPoint[] {
  const stepMs = bucket === 'hour' ? HOUR_MS : DAY_MS
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = new Date(pointsStart.getTime() + index * stepMs)
    return {
      bucketStart: start.toISOString(),
      label: bucketLabel(bucket, start),
      runCount: 0,
      inputTokens: 0,
      outputTokens: 0,
    }
  })
}
