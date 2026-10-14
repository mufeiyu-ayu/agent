import { Ajv } from 'ajv'

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required, additionalProperties: false })
const text = (maxLength = 128) => ({ type: 'string', minLength: 1, maxLength })
const list = (items: unknown, maxItems: number, minItems = 0) => ({ type: 'array', items, maxItems, minItems, uniqueItems: true })
const choice = (values: string[]) => ({ type: 'string', enum: values })
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum })
const date = { ...text(10), pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const dimensions = ['date', 'hour', 'page', 'query', 'country', 'device', 'searchAppearance']
const filterDimensions = dimensions.filter(name => !['date', 'hour'].includes(name))
export interface GscQueryInput {
  startDate: string
  endDate: string
  dimensions?: string[]
  type?: string
  dimensionFilterGroups?: Array<{ groupType: 'and', filters: Array<{ dimension: string, operator?: string, expression: string }> }>
  dataState?: 'final' | 'all' | 'hourly_all'
  aggregationType?: 'auto' | 'byProperty' | 'byPage'
  rowLimit?: number
  startRow?: number
}
export const gscQuerySchema = object({
  startDate: date,
  endDate: date,
  dimensions: list(choice(dimensions), 7),
  type: choice(['web', 'image', 'video', 'news', 'discover', 'googleNews']),
  dimensionFilterGroups: list(object({ groupType: choice(['and']), filters: list(object({
    dimension: choice(filterDimensions),
    operator: choice(['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex']),
    expression: text(4096),
  }, ['dimension', 'expression']), 20, 1) }, ['groupType', 'filters']), 5),
  dataState: choice(['final', 'all', 'hourly_all']),
  aggregationType: choice(['auto', 'byProperty', 'byPage']),
  rowLimit: integer(1, 1000),
  startRow: integer(0, 100000),
}, ['startDate', 'endDate'])

export interface MetadataInput { customOnly?: boolean, search?: string }
export const metadataSchema = object({ customOnly: { type: 'boolean' }, search: text(100) })

export interface FilterExpression {
  andGroup?: { expressions: FilterExpression[] }
  orGroup?: { expressions: FilterExpression[] }
  notExpression?: FilterExpression
  filter?: {
    fieldName: string
    stringFilter?: { matchType: string, value: string, caseSensitive?: boolean }
    inListFilter?: { values: string[], caseSensitive?: boolean }
    numericFilter?: { operation: string, value: { int64Value?: string, doubleValue?: number } }
    betweenFilter?: { fromValue: { int64Value?: string, doubleValue?: number }, toValue: { int64Value?: string, doubleValue?: number } }
  }
}
export interface Ga4QueryInput {
  dateRanges: Array<{ startDate: string, endDate: string, name?: string }>
  dimensions?: string[]
  metrics: string[]
  dimensionFilter?: FilterExpression
  metricFilter?: FilterExpression
  orderBys?: Array<{ dimension?: { dimensionName: string, orderType?: string }, metric?: { metricName: string }, desc?: boolean }>
  limit?: number
  offset?: number
  currencyCode?: string
}
const numericValue = { ...object({ int64Value: { ...text(21), pattern: '^-?\\d+$' }, doubleValue: { type: 'number' } }), oneOf: [{ required: ['int64Value'] }, { required: ['doubleValue'] }] }
const dimensionLeaf = object({
  fieldName: text(),
  stringFilter: object({ matchType: choice(['EXACT', 'BEGINS_WITH', 'ENDS_WITH', 'CONTAINS', 'FULL_REGEXP', 'PARTIAL_REGEXP']), value: text(4096), caseSensitive: { type: 'boolean' } }, ['matchType', 'value']),
  inListFilter: object({ values: list(text(4096), 50, 1), caseSensitive: { type: 'boolean' } }, ['values']),
}, ['fieldName'])
const metricLeaf = object({
  fieldName: text(),
  numericFilter: object({ operation: choice(['EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL', 'GREATER_THAN', 'GREATER_THAN_OR_EQUAL']), value: numericValue }, ['operation', 'value']),
  betweenFilter: object({ fromValue: numericValue, toValue: numericValue }, ['fromValue', 'toValue']),
}, ['fieldName'])
// 嵌套节点复用同一协议，执行时逐层校验；避免把指数展开的 Schema 注入模型。
function filterSchema(kind: 'dimension' | 'metric'): Record<string, unknown> {
  const filters = kind === 'dimension' ? ['stringFilter', 'inListFilter'] : ['numericFilter', 'betweenFilter']
  const child = { type: 'object', description: '同样的 FilterExpression 结构，逻辑组合最多嵌套三层。' }
  const properties = {
    filter: { ...(kind === 'dimension' ? dimensionLeaf : metricLeaf), oneOf: filters.map(name => ({ required: [name] })) },
    andGroup: object({ expressions: list(child, 20, 1) }, ['expressions']),
    orGroup: object({ expressions: list(child, 20, 1) }, ['expressions']),
    notExpression: child,
  }
  return { ...object(properties), oneOf: Object.keys(properties).map(name => ({ required: [name] })) }
}
export const ga4QuerySchema = object({
  dateRanges: list(object({ startDate: date, endDate: date, name: { ...text(40), pattern: '^(?!date_range_|RESERVED_).+$' } }, ['startDate', 'endDate']), 2, 1),
  dimensions: list(text(), 9),
  metrics: list(text(), 10, 1),
  dimensionFilter: filterSchema('dimension'),
  metricFilter: filterSchema('metric'),
  orderBys: list({ ...object({
    dimension: object({ dimensionName: text(), orderType: choice(['ALPHANUMERIC', 'CASE_INSENSITIVE_ALPHANUMERIC', 'NUMERIC']) }, ['dimensionName']),
    metric: object({ metricName: text() }, ['metricName']),
    desc: { type: 'boolean' },
  }), oneOf: [{ required: ['dimension'] }, { required: ['metric'] }] }, 5),
  limit: integer(1, 1000),
  offset: integer(0, 100000),
  currencyCode: { ...text(3), pattern: '^[A-Z]{3}$' },
}, ['dateRanges', 'metrics'])
const ajv = new Ajv({ strict: false, strictNumbers: true, allErrors: false })
const validateGsc = ajv.compile<GscQueryInput>(gscQuerySchema)
const validateGa4 = ajv.compile<Ga4QueryInput>(ga4QuerySchema)
const validateMetadata = ajv.compile<MetadataInput>(metadataSchema)
const validateDimensionFilter = ajv.compile(filterSchema('dimension'))
const validateMetricFilter = ajv.compile(filterSchema('metric'))
function validateFilter(input: FilterExpression | undefined, kind: 'dimension' | 'metric', depth = 0): void {
  if (!input)
    return
  if (depth > 3 || !(kind === 'dimension' ? validateDimensionFilter : validateMetricFilter)(input))
    throw new Error('invalid filter expression')
  if (input.filter) {
    const values = input.filter.numericFilter
      ? [input.filter.numericFilter.value]
      : input.filter.betweenFilter ? [input.filter.betweenFilter.fromValue, input.filter.betweenFilter.toValue] : []
    for (const value of values) {
      if (value.int64Value !== undefined && (BigInt(value.int64Value) < -9223372036854775808n || BigInt(value.int64Value) > 9223372036854775807n))
        throw new Error('numeric filter exceeds int64')
    }
    return
  }
  for (const child of input.notExpression ? [input.notExpression] : input.andGroup?.expressions ?? input.orGroup?.expressions ?? []) validateFilter(child, kind, depth + 1)
}
function validSize(value: unknown) {
  if (JSON.stringify(value)?.length > 12000)
    throw new Error('query arguments exceed 12000 characters')
}
function day(value: string) {
  const time = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw new Error('invalid calendar date')
  return time
}
function dates(start: string, end: string) {
  const span = (day(end) - day(start)) / 86400000
  if (span < 0 || span >= 366)
    throw new Error('date range must be between 1 and 366 days')
}
export function parseGscQuery(value: unknown): GscQueryInput {
  validSize(value)
  if (!validateGsc(value))
    throw new Error('invalid gsc_query arguments')
  const input = value as GscQueryInput
  dates(input.startDate, input.endDate)
  const filters = input.dimensionFilterGroups?.flatMap(group => group.filters) ?? []
  if (filters.length > 20)
    throw new Error('too many filters')
  const page = input.dimensions?.includes('page') || filters.some(filter => filter.dimension === 'page')
  if (input.aggregationType === 'byProperty' && (page || ['discover', 'googleNews'].includes(input.type ?? 'web')))
    throw new Error('incompatible property aggregation')
  if (!!input.dimensions?.includes('hour') !== (input.dataState === 'hourly_all'))
    throw new Error('hour requires hourly_all and vice versa')
  return input
}
export function parseMetadata(value: unknown): MetadataInput {
  if (!validateMetadata(value))
    throw new Error('invalid ga4_metadata arguments')
  return value as MetadataInput
}
export function filterFields(input?: FilterExpression): string[] {
  if (!input)
    return []
  if (input.filter)
    return [input.filter.fieldName]
  if (input.notExpression)
    return filterFields(input.notExpression)
  return (input.andGroup?.expressions ?? input.orGroup?.expressions ?? []).flatMap(filterFields)
}
export function parseGa4Query(value: unknown): Ga4QueryInput {
  validSize(value)
  if (!validateGa4(value))
    throw new Error('invalid ga4_query arguments')
  const input = value as Ga4QueryInput
  validateFilter(input.dimensionFilter, 'dimension')
  validateFilter(input.metricFilter, 'metric')
  input.dateRanges.forEach(range => dates(range.startDate, range.endDate))
  const names = input.dateRanges.map((range, index) => range.name ?? `date_range_${index}`)
  if (new Set(names).size !== names.length)
    throw new Error('duplicate date range names')
  if (filterFields(input.dimensionFilter).length + filterFields(input.metricFilter).length > 20)
    throw new Error('too many filters')
  for (const order of input.orderBys ?? []) {
    if (order.dimension && !input.dimensions?.includes(order.dimension.dimensionName))
      throw new Error('sort dimension is not selected')
    if (order.metric && !input.metrics.includes(order.metric.metricName))
      throw new Error('sort metric is not selected')
  }
  return input
}
