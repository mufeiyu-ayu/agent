/** Admin 持久化 JSON 投影只接受普通对象，不透传数组或原始异常值。 */
export function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function isRequiredString(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return typeof object[key] === 'string' && object[key].trim().length > 0
}

export function isRequiredNonNegativeInteger(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return readNonNegativeInteger(object, key) !== null
}

export function readString(
  object: Record<string, unknown> | null,
  key: string,
  maxChars = 128,
): string | null {
  const value = object?.[key]
  return typeof value === 'string'
    ? toPreview(value, maxChars)
    : null
}

export function readNonNegativeInteger(
  object: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = object?.[key]
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null
}

export function readPositiveInteger(
  object: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = readNonNegativeInteger(object, key)
  return value !== null && value > 0 ? value : null
}

export function readAllowedString<T extends string>(
  object: Record<string, unknown> | null,
  key: string,
  allowed: T[],
): T | null {
  const value = object?.[key]
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : null
}

export function readBoolean(
  object: Record<string, unknown> | null,
  key: string,
): boolean | null {
  const value = object?.[key]
  return typeof value === 'boolean' ? value : null
}

export function toPreview(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const characters = [...normalized]

  return characters.length <= maxChars
    ? normalized
    : `${characters.slice(0, maxChars - 1).join('')}…`
}

export function elapsedMs(
  startedAt: Date | null,
  endedAt: Date | null,
): number | null {
  if (!startedAt || !endedAt)
    return null

  const duration = endedAt.getTime() - startedAt.getTime()
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

export function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null
}
