import type { ToolStepSummary } from './tool.types.js'

/**
 * Tool Step Summary 是审计辅助元数据，不是 Observation 副本，也不是业务结果。
 *
 * 这里的预算刻意保持很小：合法 summary 只应包含 status、strategy、计数和少量
 * source / chunk 引用；一旦体积接近 Observation 量级，说明 Tool 放错了内容。
 */
export const TOOL_STEP_SUMMARY_MAX_CHARS = 2_000

/** 顶层对象记为第 1 层；足够表达 `{ strategy: {...}, sources: [{...}] }` 结构。 */
export const TOOL_STEP_SUMMARY_MAX_DEPTH = 5

/**
 * 校验 Tool 自愿提供的 Step Summary 是否可以安全持久化。
 *
 * fail closed：只要不是 JSON-compatible 的普通对象、超出字符预算或超出嵌套深度，
 * 一律返回 `undefined`，由调用方跳过写入。拒绝原因不携带原始 summary 内容，
 * 避免把本就可疑的数据再写进日志或错误消息。
 *
 * @returns 通过校验的 summary；非法时为 `undefined`。
 */
export function normalizeToolStepSummary(
  summary: unknown,
): ToolStepSummary | undefined {
  if (summary === undefined)
    return undefined

  if (!isPlainObject(summary))
    return undefined

  if (!isJsonSafe(summary, 1, new Set()))
    return undefined

  let serialized: string

  try {
    serialized = JSON.stringify(summary)
  }
  catch {
    return undefined
  }

  // `JSON.stringify` 对只含 undefined 值的对象仍返回 `{}`；上面的深度校验已排除该情况。
  if (typeof serialized !== 'string')
    return undefined

  if ([...serialized].length > TOOL_STEP_SUMMARY_MAX_CHARS)
    return undefined

  return summary as ToolStepSummary
}

function isJsonSafe(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): boolean {
  if (value === null)
    return true

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true

    case 'number':
      // NaN 与 Infinity 会被 JSON.stringify 静默写成 null，属于语义损坏。
      return Number.isFinite(value)

    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      return false
  }

  if (depth > TOOL_STEP_SUMMARY_MAX_DEPTH)
    return false

  const container = value as object

  // 只拒绝祖先链上的重复引用；兄弟位置出现同一对象不算循环。
  if (ancestors.has(container))
    return false

  ancestors.add(container)

  try {
    if (Array.isArray(container)) {
      return container.every(item => isJsonSafe(item, depth + 1, ancestors))
    }

    if (!isPlainObject(container))
      return false

    return Object.values(container).every(
      item => isJsonSafe(item, depth + 1, ancestors),
    )
  }
  finally {
    ancestors.delete(container)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
