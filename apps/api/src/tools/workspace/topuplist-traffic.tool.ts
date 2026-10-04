import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ToolResult, ValidatedToolInvocation } from '../core/tool.types.js'
import { Injectable } from '@nestjs/common'

/** 固定业务 Demo；明确标识来源，之后可替换为已授权的业务接口。 */
export function topuplistTraffic(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' })
  const today = formatter.format(now)
  const base = new Date(`${today}T00:00:00Z`).getTime()
  const daily = Array.from({ length: 7 }, (_, index) => ({
    date: new Date(base - (7 - index) * 86400_000).toISOString().slice(0, 10),
    visitors: [4120, 4560, 4380, 4920, 5340, 5180, 5860][index]!,
    pageViews: [9830, 10890, 10210, 11640, 12920, 12340, 14110][index]!,
    sessions: [4830, 5320, 5100, 5750, 6260, 6100, 6890][index]!,
  }))
  return {
    site: 'topuplist',
    source: 'demo',
    sourceLabel: '演示数据，非真实网站统计',
    timezone: 'Asia/Shanghai',
    period: { start: daily[0]!.date, end: daily[6]!.date, days: 7 },
    daily,
    totals: { visitors: daily.reduce((sum, day) => sum + day.visitors, 0), pageViews: daily.reduce((sum, day) => sum + day.pageViews, 0), sessions: daily.reduce((sum, day) => sum + day.sessions, 0) },
    channels: [{ name: '自然搜索', visitors: 17524 }, { name: '直接访问', visitors: 9176 }, { name: '推荐链接', visitors: 4862 }, { name: '社交媒体', visitors: 2798 }],
    topPages: [{ path: '/', views: 28310 }, { path: '/games', views: 18240 }, { path: '/gift-cards', views: 14320 }, { path: '/blog', views: 10920 }, { path: '/offers', views: 10150 }],
  }
}

export const trafficDefinition: ToolDefinition<{ days: number }> = {
  name: 'topuplist_traffic',
  version: '1',
  description: '获取 topuplist 最近七个完整日期的网站流量 Demo：每日访客、会话、浏览量、渠道和热门页面。数据是固定演示数据，必须向用户标注演示来源。可用 write 将结果写入工作文件，制作并验证页面。',
  timeoutMs: 5_000,
  maxObservationChars: 8_000,
  input: {
    schema: { type: 'object', properties: { days: { type: 'integer', enum: [7] } }, required: [], additionalProperties: false },
    parse(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'days') || ('days' in value && value.days !== 7))
        throw new Error('仅支持七天 Demo')
      return { days: 7 }
    },
  },
}

@Injectable()
export class TopuplistTrafficTool implements ToolExecutor<{ days: number }> {
  async execute(_invocation: ValidatedToolInvocation<{ days: number }>, context: ToolExecutionContext): Promise<ToolResult> {
    context.signal.throwIfAborted()
    return { ok: true, modelContent: JSON.stringify(topuplistTraffic()), display: { workspace: { operation: 'traffic', title: '获取最近七天的流量演示数据' } } }
  }
}
