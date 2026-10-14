import type { Ga4QueryInput, GscQueryInput, MetadataInput } from '../../google-data/google-query-input.js'
import type { InspectionInput } from '../../google-data/gsc-inspection.js'
import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ValidatedToolInvocation } from '../core/tool.types.js'
import { HttpException, Inject, Injectable } from '@nestjs/common'
import { GoogleDataError } from '../../google-data/google-data-client.js'
import { ga4QuerySchema, gscQuerySchema, metadataSchema, parseGa4Query, parseGscQuery, parseMetadata } from '../../google-data/google-query-input.js'
import { GoogleQueryService, queryObservation } from '../../google-data/google-query.service.js'
import { inspectionObservation, inspectionSchema, parseInspection } from '../../google-data/gsc-inspection.js'
import { GscInspectionService } from '../../google-data/gsc-inspection.service.js'

export const gscQueryDefinition: ToolDefinition<GscQueryInput> = {
  name: 'gsc_query',
  version: '1',
  description: '查询当前用户已选 Search Console 站点的真实搜索表现。日期为YYYY-MM-DD、按美国太平洋日；dimensions=[]查询总计，可按date/page/query/country/device/searchAppearance分组。hour须配hourly_all且仅最近10天。返回clicks/impressions/ctr/position及质量提示。单页默认100最多1000行，不保证Google返回全量；按nextOffset继续时填startRow。用户/站点/令牌由平台决定，不接受身份或站点参数。参数总量最多12000字符。',
  input: { schema: gscQuerySchema, parse: parseGscQuery },
  timeoutMs: 30_000,
  maxObservationChars: 24_000,
}
export const ga4MetadataDefinition: ToolDefinition<MetadataInput> = {
  name: 'ga4_metadata',
  version: '1',
  description: '查看当前用户已选GA4资源的可查询字段。customOnly默认true，只列自定义维度/指标；要查标准字段如sessions、date，传false。search按API名、显示名和说明筛选。最多返回100项，截断后缩小search；不要猜测自定义字段。资源由平台决定。',
  input: { schema: metadataSchema, parse: parseMetadata },
  timeoutMs: 30_000,
  maxObservationChars: 24_000,
}
export const ga4QueryDefinition: ToolDefinition<Ga4QueryInput> = {
  name: 'ga4_query',
  version: '1',
  description: '查询当前用户已选GA4资源的真实报表，平台强制过滤已选数据流。dateRanges为1至2个YYYY-MM-DD日期区间（各最多366天）；metrics为字段名数组，dimensions=[]查总计。自定义字段先用ga4_metadata确认。支持Google camelCase FilterExpression（andGroup/orGroup/notExpression/filter，最多三层20叶子）、orderBys、currencyCode。limit默认100最多1000、offset最多100000；按nextOffset继续。保留原始数值字符串与时区/币种/采样等metadata，不将缺行当0或将GA4购买金额当净利润。不能指定userId/propertyId/streamId或令牌。参数总量最多12000字符。',
  input: { schema: ga4QuerySchema, parse: parseGa4Query },
  timeoutMs: 30_000,
  maxObservationChars: 24_000,
}
const messages: Record<string, string> = {
  pageOutsideSite: '精确筛选的页面 URL 不在所选 GSC 站点范围内，请先在插件页核对站点。',
  inspectionOutsideSite: '待检查 URL 不属于当前选择的 GSC 站点，请核对站点范围。',
  needsAuth: '请在插件页连接 Google 数据或重新授权。',
  selectResource: '请先在 Google 数据连接中选择并保存所需服务的资源。',
  missingScope: '尚未授予此服务的只读权限，请调整 Google 授权。',
  connectionChanged: '本次对话查询所用的连接或资源已改变，请在确认资源后发起新的问题。',
  authorizationPending: 'Google 授权尚未完成，请先完成或取消授权。',
  permissionDenied: 'Google 拒绝访问，请检查该账号的资源权限及平台 API 配置。',
  quotaExceeded: 'Google 配额暂时不足，请稍后重试。',
  upstreamFailed: 'Google 请求失败，本次没有可用于分析的数据。',
  timeout: 'Google 查询超时，本次没有取得结果。',
  invalidResponse: 'Google 返回的数据格式无效，不能据此分析。',
  tooManyResources: 'Google 响应超过读取上限，请缩小查询。',
  unknownField: '查询字段不在当前资源元数据中；请用 ga4_metadata 确认，维度与指标不能混用。',
  queryRejected: 'Google 拒绝此查询的参数或字段组合；请检查字段兼容性、筛选、日期和币种，不要把失败当成无数据。',
  hourlyWindow: 'GSC 小时数据仅支持按美国太平洋日期计算的最近10天，请缩小日期范围或改用日级数据。',
  resultTooLarge: '结果或查询说明超过工具输出上限，请减少列或缩小筛选；本次未返回不完整 JSON。',
}
async function execute<T>(context: ToolExecutionContext, query: () => Promise<T>, observation: (result: T) => string) {
  context.signal.throwIfAborted()
  if (!context.googleData)
    return { ok: false as const, code: 'execution_failed' as const, modelContent: '当前请求缺少登录身份，不能查询 Google 数据。' }
  try {
    const result = await query()
    context.signal.throwIfAborted()
    return { ok: true as const, modelContent: observation(result) }
  }
  catch (error) {
    context.signal.throwIfAborted()
    const reason = error instanceof GoogleDataError ? error.reason : error instanceof HttpException ? error.message : ''
    return { ok: false as const, code: 'execution_failed' as const, modelContent: JSON.stringify({ error: messages[reason] ?? 'Google 数据查询失败，未取得可用于分析的结果。', retryable: ['timeout', 'upstreamFailed', 'quotaExceeded'].includes(reason) }) }
  }
}
@Injectable()
export class GscQueryTool implements ToolExecutor<GscQueryInput> {
  constructor(@Inject(GoogleQueryService) private readonly queries: GoogleQueryService) {}
  execute({ input }: ValidatedToolInvocation<GscQueryInput>, context: ToolExecutionContext) { return execute(context, () => this.queries.gsc(input, context.googleData!, context.signal), queryObservation) }
}
@Injectable()
export class Ga4MetadataTool implements ToolExecutor<MetadataInput> {
  constructor(@Inject(GoogleQueryService) private readonly queries: GoogleQueryService) {}
  execute({ input }: ValidatedToolInvocation<MetadataInput>, context: ToolExecutionContext) { return execute(context, () => this.queries.fields(input, context.googleData!, context.signal), queryObservation) }
}
@Injectable()
export class Ga4QueryTool implements ToolExecutor<Ga4QueryInput> {
  constructor(@Inject(GoogleQueryService) private readonly queries: GoogleQueryService) {}
  execute({ input }: ValidatedToolInvocation<Ga4QueryInput>, context: ToolExecutionContext) { return execute(context, () => this.queries.ga4(input, context.googleData!, context.signal), queryObservation) }
}

export const gscInspectDefinition: ToolDefinition<InspectionInput> = {
  name: 'gsc_inspect',
  version: '1',
  description: '检查当前已选GSC站点内1至20个明确URL的Google索引状态；文章URL可从articles_query取得。urls必填；refresh默认false复用24小时成功缓存，true强制重查。不是实时抓取或请求收录。每站点本平台每日最多2000次检查，外部用量未知。保留原检查时间，区分其他规范页/失败/未检查；按omittedUrls继续读取被输出预算省略的结果。先报告目标URL规模，不把抽样称为全量收录率。禁止指定用户/站点/凭据。',
  input: { schema: inspectionSchema, parse: parseInspection },
  timeoutMs: 60_000,
  maxObservationChars: 24_000,
}
@Injectable()
export class GscInspectTool implements ToolExecutor<InspectionInput> {
  constructor(@Inject(GscInspectionService) private readonly inspection: GscInspectionService) {}
  execute({ input }: ValidatedToolInvocation<InspectionInput>, context: ToolExecutionContext) { return execute(context, () => this.inspection.inspect(input, context.googleData!, context.signal), inspectionObservation) }
}
