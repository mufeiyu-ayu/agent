import type {
  AdminOverviewBucket,
  AdminOverviewFailureReason,
  AdminOverviewModelItem,
  AdminOverviewPoint,
  AdminOverviewStats,
  AdminOverviewToolItem,
  AdminOverviewWindow,
  AdminProviderBalance,
  AgentRunStatus,
} from '@agent/contracts'
import {
  ADMIN_OVERVIEW_UNKNOWN_TOOL,
  ADMIN_TOOL_RESULT_CODES,
  AGENT_RUN_ERROR_CODES,
} from '@agent/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { resolveAdminModelRefs } from '../admin-runs/admin-model-refs.js'
import { readObject, readString, toAllowedString } from '../admin-runs/projection/safe-readers.js'
import { LLM_CALL_ERROR_CODES } from '../admin-runs/projection/sampling-usage.projector.js'
import { AGENT_STEP_TYPES } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { Prisma } from '../generated/prisma/client.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js'

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS

const UNAVAILABLE_BALANCE: AdminProviderBalance = {
  available: false,
  currency: null,
  totalBalance: null,
}

const AGENT_RUN_STATUSES: AgentRunStatus[] = ['RUNNING', 'COMPLETED', 'FAILED', 'ABORTED']

interface ResolvedWindow {
  bucket: AdminOverviewBucket
  /** 数据下界：小时窗口是精确的 now − 24h，日窗口是 N − 1 天前的上海零点。 */
  windowStart: Date
  /** 第一个桶的起点：小时窗口向下取整到整点，所以首桶是半桶。 */
  pointsStart: Date
  bucketCount: number
}

/** 以下行类型与 SQL 的列一一对应；数值列在 SQL 里统一转成 int / float8，驱动读出来就是 number。 */
export interface RunBucketRow {
  bucketStart: string
  status: AgentRunStatus
  runCount: number
}

export interface FailureReasonRow {
  errorCode: string | null
  runCount: number
}

export interface RunLatencyRow {
  p50Ms: number | null
  p95Ms: number | null
}

export interface CallBucketRow {
  bucketStart: string
  totalTokens: number | null
  inputTokens: number | null
  cacheHitTokens: number | null
  cacheInputTokens: number | null
  runsWithTokens: number
}

export interface ModelCallRow {
  modelId: string | null
  resolvedModel: string | null
  callCount: number
  failedCount: number
  firstTokenP50Ms: number | null
  samplingDurationP50Ms: number | null
  totalTokens: number | null
  cacheHitTokens: number | null
  cacheInputTokens: number | null
}

export interface ToolRow {
  tool: string
  callCount: number
  failedCount: number
  avgDurationMs: number | null
}

export interface ToolFailureRow {
  tool: string
  code: string | null
  failedCount: number
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

  /**
   * 窗口聚合直接在数据库里做：Step JSON 只取 usage / errorCode / 首 token 时间 / 模型快照这几个路径，
   * 不把 debug 捕获读进应用。统计单位是窗口内创建的 Run，Step 跟着 Run 进窗口。
   */
  async getStats(window: AdminOverviewWindow, now = new Date()): Promise<AdminOverviewStats> {
    const resolved = resolveWindow(window, now)
    // 列是 timestamp without time zone（存 UTC）：参数用 ISO 文本转 timestamp，不受驱动与会话时区影响。
    const windowStart = Prisma.sql`${resolved.windowStart.toISOString()}::timestamp`
    const bucketStart = bucketStartSql(resolved.bucket)
    const calls = modelCallsSql(windowStart)
    const toolName = Prisma.sql`CASE WHEN s."input" ->> 'toolName' IN (${Prisma.join(TOOL_DEFINITIONS.map(tool => tool.name))})
      THEN s."input" ->> 'toolName' ELSE ${ADMIN_OVERVIEW_UNKNOWN_TOOL} END`

    const [runBuckets, failureReasons, [latency], callBuckets, modelRows, toolRows, toolFailureRows] = await Promise.all([
      this.prismaService.$queryRaw<RunBucketRow[]>(Prisma.sql`
        SELECT ${bucketStart} AS "bucketStart", r."status"::text AS "status", count(*)::int AS "runCount"
        FROM "AgentRun" r
        WHERE r."createdAt" >= ${windowStart}
        GROUP BY 1, 2
      `),
      this.prismaService.$queryRaw<FailureReasonRow[]>(Prisma.sql`
        SELECT r."errorCode", count(*)::int AS "runCount"
        FROM "AgentRun" r
        WHERE r."createdAt" >= ${windowStart} AND r."status" IN ('FAILED', 'ABORTED')
        GROUP BY 1
      `),
      this.prismaService.$queryRaw<RunLatencyRow[]>(Prisma.sql`
        SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY d."ms") AS "p50Ms",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY d."ms") AS "p95Ms"
        FROM (
          SELECT (extract(epoch FROM r."endedAt" - r."startedAt") * 1000)::float8 AS "ms"
          FROM "AgentRun" r
          WHERE r."createdAt" >= ${windowStart} AND r."status" <> 'RUNNING' AND r."endedAt" IS NOT NULL
        ) d
      `),
      this.prismaService.$queryRaw<CallBucketRow[]>(Prisma.sql`
        ${calls}
        SELECT
          ${bucketStart} AS "bucketStart",
          sum(c."totalTokens")::float8 AS "totalTokens",
          sum(c."inputTokens")::float8 AS "inputTokens",
          sum(c."cacheHitTokens") FILTER (WHERE c."inputTokens" IS NOT NULL)::float8 AS "cacheHitTokens",
          sum(c."inputTokens") FILTER (WHERE c."cacheHitTokens" IS NOT NULL)::float8 AS "cacheInputTokens",
          count(DISTINCT c."runId") FILTER (WHERE c."totalTokens" IS NOT NULL)::int AS "runsWithTokens"
        FROM calls c
        JOIN "AgentRun" r ON r."id" = c."runId"
        GROUP BY 1
      `),
      this.prismaService.$queryRaw<ModelCallRow[]>(Prisma.sql`
        ${calls}
        SELECT
          c."modelId",
          max(c."resolvedModel") AS "resolvedModel",
          count(*)::int AS "callCount",
          count(*) FILTER (WHERE c."failed")::int AS "failedCount",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY c."firstTokenMs") AS "firstTokenP50Ms",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY c."durationMs") AS "samplingDurationP50Ms",
          sum(c."totalTokens")::float8 AS "totalTokens",
          sum(c."cacheHitTokens") FILTER (WHERE c."inputTokens" IS NOT NULL)::float8 AS "cacheHitTokens",
          sum(c."inputTokens") FILTER (WHERE c."cacheHitTokens" IS NOT NULL)::float8 AS "cacheInputTokens"
        FROM calls c
        -- 旧采样没有 modelId，按 wire name 归行；有 modelId 的同名模型跨服务商也分开。
        GROUP BY c."modelId", CASE WHEN c."modelId" IS NULL THEN c."resolvedModel" END
      `),
      this.prismaService.$queryRaw<ToolRow[]>(Prisma.sql`
        SELECT
          ${toolName} AS "tool",
          count(*)::int AS "callCount",
          count(*) FILTER (WHERE s."status" = 'FAILED')::int AS "failedCount",
          avg(extract(epoch FROM s."endedAt" - s."startedAt") * 1000) FILTER (
            WHERE s."status" IN ('COMPLETED', 'FAILED') AND s."startedAt" IS NOT NULL AND s."endedAt" IS NOT NULL
          )::float8 AS "avgDurationMs"
        FROM "AgentStep" s
        JOIN "AgentRun" r ON r."id" = s."runId"
        WHERE r."createdAt" >= ${windowStart} AND s."type" = ${AGENT_STEP_TYPES.toolExecution}
        GROUP BY 1
      `),
      this.prismaService.$queryRaw<ToolFailureRow[]>(Prisma.sql`
        SELECT ${toolName} AS "tool", s."output" ->> 'code' AS "code", count(*)::int AS "failedCount"
        FROM "AgentStep" s
        JOIN "AgentRun" r ON r."id" = s."runId"
        WHERE r."createdAt" >= ${windowStart} AND s."type" = ${AGENT_STEP_TYPES.toolExecution} AND s."status" = 'FAILED'
        GROUP BY 1, 2
      `),
    ])

    const models = await resolveAdminModelRefs(
      this.prismaService,
      modelRows.map(row => ({ modelId: row.modelId, resolvedModel: row.resolvedModel })),
    )

    return buildOverviewStats({
      window,
      resolved,
      runBuckets,
      failureReasons,
      latency: latency ?? { p50Ms: null, p95Ms: null },
      callBuckets,
      // 快照里既没有 modelId 也没有 wire name 的调用照样计入，模型为 null，与运行列表的「未记录」一致。
      modelRows: modelRows.map((row, index) => ({ ...row, model: models[index] ?? null })),
      toolRows,
      toolFailureRows,
    })
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

/**
 * 窗口内 Run 的全部真实模型调用，口径与运行列表 `aggregateRunModelCalls` 相同：
 * action sampling Step 与 finalization attempt 中，有 usage 或以 llm_* 类别失败的才算。
 * finalization 的模型取同一 Run 第一条采样的快照，首 token 时间与时长只有 action sampling 记录。
 */
function modelCallsSql(windowStart: Prisma.Sql): Prisma.Sql {
  const llmCodes = Prisma.join([...LLM_CALL_ERROR_CODES])
  const usageNumber = (usage: Prisma.Sql, key: string) => nonNegativeIntegerSql(Prisma.sql`${usage} -> ${key}::text`)

  return Prisma.sql`
    WITH window_runs AS (
      SELECT r."id", r."errorCode"
      FROM "AgentRun" r
      WHERE r."createdAt" >= ${windowStart}
    ),
    sampling AS (
      SELECT
        s."runId",
        s."sequence",
        s."status",
        s."startedAt",
        s."endedAt",
        -- 空串与缺失同样按「没有记录」归组，与运行列表的读取一致。
        nullif(s."input" -> 'initialContext' ->> 'modelId', '') AS "modelId",
        nullif(s."input" -> 'initialContext' ->> 'resolvedModel', '') AS "resolvedModel",
        s."output" -> 'usage' AS "usage",
        s."output" ->> 'errorCode' AS "errorCode",
        s."output" -> 'firstTokenMs' AS "firstTokenMs"
      FROM "AgentStep" s
      JOIN window_runs r ON r."id" = s."runId"
      WHERE s."type" = ${AGENT_STEP_TYPES.modelSampling}
    ),
    run_models AS (
      SELECT DISTINCT ON (s."runId") s."runId", s."modelId", s."resolvedModel"
      FROM sampling s
      ORDER BY s."runId", s."sequence"
    ),
    raw_calls AS (
      SELECT
        s."runId",
        s."modelId",
        s."resolvedModel",
        s."usage",
        coalesce(s."errorCode" IN (${llmCodes}), false) AS "failed",
        ${nonNegativeIntegerSql(Prisma.sql`s."firstTokenMs"`)}::float8 AS "firstTokenMs",
        CASE WHEN s."status" = 'COMPLETED' AND s."startedAt" IS NOT NULL AND s."endedAt" IS NOT NULL
          THEN (extract(epoch FROM s."endedAt" - s."startedAt") * 1000)::float8
        END AS "durationMs"
      FROM sampling s
      UNION ALL
      SELECT
        f."runId",
        m."modelId",
        m."resolvedModel",
        a."attempt" -> 'usage',
        coalesce(jsonb_typeof(a."attempt" -> 'samplingFailure') = 'string' AND r."errorCode" IN (${llmCodes}), false),
        NULL,
        NULL
      FROM "AgentStep" f
      JOIN window_runs r ON r."id" = f."runId"
      LEFT JOIN run_models m ON m."runId" = f."runId"
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(f."output" -> 'attempts') = 'array' THEN f."output" -> 'attempts' ELSE '[]'::jsonb END
      ) AS a("attempt")
      WHERE f."type" = ${AGENT_STEP_TYPES.groundedFinalization}
    ),
    calls AS (
      SELECT
        c."runId",
        c."modelId",
        c."resolvedModel",
        c."failed",
        c."firstTokenMs",
        c."durationMs",
        ${usageNumber(Prisma.sql`c."usage"`, 'totalTokens')} AS "totalTokens",
        ${usageNumber(Prisma.sql`c."usage"`, 'inputTokens')} AS "inputTokens",
        ${usageNumber(Prisma.sql`c."usage"`, 'promptCacheHitTokens')} AS "cacheHitTokens"
      FROM raw_calls c
      -- 从未发出请求的采样（估算失败、上下文溢出、请求前取消）既没有 usage 也没有 llm_* 类别。
      WHERE jsonb_typeof(c."usage") = 'object' OR c."failed"
    )
  `
}

/**
 * 与运行列表 `readNonNegativeInteger` 同一口径：只认非负安全整数，负数、小数、超界与非数字都读成 null，
 * 两边对同一条异常数据的取舍一致。
 */
function nonNegativeIntegerSql(json: Prisma.Sql): Prisma.Sql {
  const value = Prisma.sql`(${json} #>> '{}')::numeric`
  // 嵌套 CASE：AND 的求值顺序不保证，非数字 JSON 必须先被外层挡住，才轮到 numeric 转换。
  return Prisma.sql`CASE WHEN jsonb_typeof(${json}) = 'number' THEN
    CASE WHEN ${value} >= 0 AND ${value} = trunc(${value}) AND ${value} <= ${Number.MAX_SAFE_INTEGER} THEN ${value} END
  END`
}

/** 整点按 UTC 与上海一致、日桶为上海零点；输出与 `createEmptyPoints` 同格式的 ISO 文本，直接按字符串对上预建的桶。 */
function bucketStartSql(bucket: AdminOverviewBucket): Prisma.Sql {
  const start = bucket === 'hour'
    ? Prisma.sql`date_trunc('hour', r."createdAt")`
    : Prisma.sql`date_trunc('day', r."createdAt" + interval '8 hours') - interval '8 hours'`
  return Prisma.sql`to_char(${start}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

interface OverviewRows {
  window: AdminOverviewWindow
  resolved: ResolvedWindow
  runBuckets: RunBucketRow[]
  failureReasons: FailureReasonRow[]
  latency: RunLatencyRow
  callBuckets: CallBucketRow[]
  modelRows: Array<ModelCallRow & { model: AdminOverviewModelItem['model'] }>
  toolRows: ToolRow[]
  toolFailureRows: ToolFailureRow[]
}

/** SQL 行 → 契约：补零、算比率、排序。纯函数，单测直接喂行。 */
export function buildOverviewStats(rows: OverviewRows): AdminOverviewStats {
  const { bucket, pointsStart, bucketCount } = rows.resolved
  const points = createEmptyPoints(bucket, bucketCount, pointsStart)
  const pointByBucket = new Map(points.map(point => [point.bucketStart, point]))
  const statusCounts = emptyStatusCounts()

  for (const row of rows.runBuckets) {
    statusCounts[row.status] += row.runCount
    const point = pointByBucket.get(row.bucketStart)
    if (point)
      point.statusCounts[row.status] += row.runCount
  }

  let totalTokens = 0
  let inputTokens = 0
  let cacheHitTokens: number | null = null
  let cacheInputTokens: number | null = null
  let runsWithTokens = 0

  for (const row of rows.callBuckets) {
    totalTokens += row.totalTokens ?? 0
    inputTokens += row.inputTokens ?? 0
    runsWithTokens += row.runsWithTokens
    if (row.cacheHitTokens !== null && row.cacheInputTokens !== null) {
      cacheHitTokens = (cacheHitTokens ?? 0) + row.cacheHitTokens
      cacheInputTokens = (cacheInputTokens ?? 0) + row.cacheInputTokens
    }
    const point = pointByBucket.get(row.bucketStart)
    if (point)
      point.totalTokens += row.totalTokens ?? 0
  }

  const settledRuns = statusCounts.COMPLETED + statusCounts.FAILED + statusCounts.ABORTED
  const modelTokenTotal = rows.modelRows.reduce((total, row) => total + (row.totalTokens ?? 0), 0)

  return {
    window: rows.window,
    bucket,
    health: {
      runCount: AGENT_RUN_STATUSES.reduce((total, status) => total + statusCounts[status], 0),
      statusCounts,
      successRate: ratio(statusCounts.COMPLETED, settledRuns),
      // 未知取值与旧 Run 一样归到「未记录」。
      failureReasons: tallyDesc(rows.failureReasons.map(row => ({
        key: toAllowedString(row.errorCode, AGENT_RUN_ERROR_CODES),
        count: row.runCount,
      }))).map(({ key, count }): AdminOverviewFailureReason => ({ errorCode: key, count })),
    },
    latency: {
      runDurationP50Ms: roundOrNull(rows.latency.p50Ms),
      runDurationP95Ms: roundOrNull(rows.latency.p95Ms),
    },
    usage: {
      totalTokens,
      avgTokensPerRun: runsWithTokens === 0 ? null : Math.round(totalTokens / runsWithTokens),
      cacheHitRate: cacheHitTokens === null ? null : ratio(cacheHitTokens, cacheInputTokens ?? 0),
      cacheCoverage: cacheInputTokens === null ? (inputTokens === 0 ? null : 0) : ratio(cacheInputTokens, inputTokens),
    },
    points,
    models: rows.modelRows
      .map((row): AdminOverviewModelItem => ({
        model: row.model,
        callCount: row.callCount,
        failureRate: ratio(row.failedCount, row.callCount) ?? 0,
        firstTokenP50Ms: roundOrNull(row.firstTokenP50Ms),
        samplingDurationP50Ms: roundOrNull(row.samplingDurationP50Ms),
        totalTokens: row.totalTokens ?? 0,
        tokenShare: ratio(row.totalTokens ?? 0, modelTokenTotal) ?? 0,
        cacheHitRate: row.cacheHitTokens === null || row.cacheInputTokens === null
          ? null
          : ratio(row.cacheHitTokens, row.cacheInputTokens),
      }))
      .sort((left, right) => right.totalTokens - left.totalTokens || right.callCount - left.callCount),
    tools: rows.toolRows
      .map((row): AdminOverviewToolItem => ({
        tool: row.tool,
        callCount: row.callCount,
        failureRate: ratio(row.failedCount, row.callCount) ?? 0,
        failureCodes: tallyDesc(rows.toolFailureRows
          .filter(failure => failure.tool === row.tool)
          .map(failure => ({
            key: toAllowedString(failure.code, ADMIN_TOOL_RESULT_CODES),
            count: failure.failedCount,
          }))).map(({ key, count }) => ({ code: key, count })),
        avgDurationMs: roundOrNull(row.avgDurationMs),
      }))
      .sort((left, right) => right.callCount - left.callCount),
  }
}

/** 按取值合并计数后按次数降序：非法取值已映射成 null，要和原本的 null 合成一行。 */
function tallyDesc<K>(entries: Array<{ key: K, count: number }>): Array<{ key: K, count: number }> {
  const counts = new Map<K, number>()
  for (const { key, count } of entries)
    counts.set(key, (counts.get(key) ?? 0) + count)
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value)
}

function emptyStatusCounts(): Record<AgentRunStatus, number> {
  return { RUNNING: 0, COMPLETED: 0, FAILED: 0, ABORTED: 0 }
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
      statusCounts: emptyStatusCounts(),
      totalTokens: 0,
    }
  })
}
