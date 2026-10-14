import type { GoogleQueryRun } from './google-query.service.js'
import type { InspectionInput, InspectionResult, InspectionRow, InspectionStatus } from './gsc-inspection.js'
import { createHash } from 'node:crypto'
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { GOOGLE_DATA_URLS, GoogleDataError } from './google-data-client.js'
import { GoogleDataService } from './google-data.service.js'
import { inspectionBudgetDay, inspectionStatus, withinGscSite } from './gsc-inspection.js'

const BUDGET_EXHAUSTED = '本平台该站点今日检查预算已用完'

@Injectable()
export class GscInspectionService {
  constructor(@Inject(GoogleDataService) private readonly google: GoogleDataService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  async inspect(input: InspectionInput, run: GoogleQueryRun, signal: AbortSignal): Promise<InspectionResult> {
    signal.throwIfAborted()
    const connection = await this.google.queryConnection(run.userId, 'gsc', run.revision)
    if (run.revision !== undefined && run.revision !== connection.revision)
      throw new ConflictException('connectionChanged')
    run.revision = connection.revision
    if (!connection.googleSub)
      throw new BadRequestException('needsAuth')
    const siteUrl = connection.gscSite!
    if (input.urls.some(url => !withinGscSite(url, siteUrl)))
      throw new BadRequestException('inspectionOutsideSite')
    const days = new Set<string>()
    const rows: InspectionRow[] = input.urls.map(url => ({ url, status: 'not_checked', checkedAt: null, cached: false }))
    let next = 0
    let stop: string | undefined
    const deadline = AbortSignal.timeout(45_000)
    const batch = new AbortController()
    const requestSignal = AbortSignal.any([signal, deadline, batch.signal])
    const worker = async () => {
      while (next < rows.length && !batch.signal.aborted && (!stop || stop === BUDGET_EXHAUSTED || stop === 'quotaExceeded')) {
        signal.throwIfAborted()
        if (deadline.aborted) {
          stop = '批次时间已用完，请继续检查剩余 URL'
          break
        }
        const index = next++
        const target = rows[index]!
        const id = createHash('sha256').update(JSON.stringify([run.userId, connection.googleSub, siteUrl, target.url])).digest('hex')
        const saved = await this.prisma.googleInspection.findUnique({ where: { id } })
        await this.google.queryConnection(run.userId, 'gsc', connection.revision)
        signal.throwIfAborted()
        if (!input.refresh && saved && Date.now() - saved.checkedAt.getTime() < 86400_000) {
          const value = saved.result as unknown as InspectionStatus
          rows[index] = { ...target, status: value.status, index: value, checkedAt: saved.checkedAt.toISOString(), cached: true }
          continue
        }
        if (stop || deadline.aborted)
          continue
        const day = inspectionBudgetDay()
        days.add(day)
        const reserved = await this.prisma.$queryRaw<Array<{ used: number }>>`
          INSERT INTO "GoogleInspectionBudget" ("siteUrl", "day", "used") VALUES (${siteUrl}, ${day}, 1)
          ON CONFLICT ("siteUrl", "day") DO UPDATE SET "used" = "GoogleInspectionBudget"."used" + 1
          WHERE "GoogleInspectionBudget"."used" < 2000 RETURNING "used"`
        if (!reserved.length) {
          stop = BUDGET_EXHAUSTED
          continue
        }
        try {
          const response = await this.google.queryRequest(connection, GOOGLE_DATA_URLS.inspect, { inspectionUrl: target.url, siteUrl, languageCode: 'en-US' }, requestSignal)
          const value = inspectionStatus(response, target.url)
          const checkedAt = new Date()
          signal.throwIfAborted()
          await this.prisma.googleInspection.upsert({
            where: { id },
            create: { id, userId: run.userId, googleSub: connection.googleSub!, siteUrl, url: target.url, result: value, checkedAt },
            update: { result: value, checkedAt },
          })
          rows[index] = { ...target, status: value.status, index: value, checkedAt: checkedAt.toISOString() }
        }
        catch (error) {
          signal.throwIfAborted()
          if (error instanceof ConflictException || (error instanceof BadRequestException && error.message === 'needsAuth'))
            throw error
          const reason = error instanceof GoogleDataError ? error.reason : 'queryFailed'
          rows[index] = { ...target, status: 'error', error: reason }
          if (['needsAuth', 'permissionDenied', 'quotaExceeded'].includes(reason) || deadline.aborted)
            stop = reason
        }
      }
    }
    const completed = await Promise.allSettled([0, 1].map(async () => {
      try {
        await worker()
      }
      catch (error) {
        stop = '连接或查询状态已改变'
        batch.abort(error)
        throw error
      }
    }))
    for (const result of completed) {
      if (result.status === 'rejected')
        throw result.reason
    }
    signal.throwIfAborted()
    await this.google.queryConnection(run.userId, 'gsc', connection.revision)
    for (const row of rows) {
      if (row.status === 'not_checked')
        row.error = stop ?? '本次未检查'
    }
    return {
      service: 'gsc_inspect',
      source: { siteUrl },
      fetchedAt: new Date().toISOString(),
      rows,
      summary: { targetCount: rows.length, checkedCount: rows.filter(row => row.checkedAt !== null).length, cachedCount: rows.filter(row => row.cached).length, failedCount: rows.filter(row => row.status === 'error').length, uncheckedCount: rows.filter(row => row.status === 'not_checked').length },
      budget: { days: [...days], limit: 2000, scope: '本平台按站点和太平洋日的检查预算；days为本批预留预算涉及日期，缓存不计数。其他系统调用不在本计数内，不代表 Google 实时余额' },
      warning: 'Google 已记录的索引版本，不是实时抓取；逐 URL 保留检查时间，缓存不产生新检查。其他规范页、失败和未检查必须单列，不能用部分结果声称全量收录率。',
    }
  }
}
