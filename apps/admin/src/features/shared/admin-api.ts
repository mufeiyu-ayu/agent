import type { ApiSuccessResponse } from '@agent/contracts'
import { i18n } from '@/i18n'

/** admin 通用 JSON 请求层：runs / conversations 等所有 admin feature 共用。 */

export interface AdminRunFetchOptions {
  signal?: AbortSignal
}

type AdminRunErrorMessage = string | (() => string)

export class AdminRunApiError extends Error {
  constructor(
    readonly status: number,
    readonly messageSource: AdminRunErrorMessage,
    options?: ErrorOptions,
  ) {
    super(typeof messageSource === 'string' ? messageSource : messageSource(), options)
    this.name = 'AdminRunApiError'
  }
}

export function formatAdminRunError(error: unknown): string {
  if (error instanceof AdminRunApiError) {
    return typeof error.messageSource === 'string'
      ? error.messageSource
      : error.messageSource()
  }

  return error instanceof Error ? error.message : i18n.global.t('errors.generic')
}

export function appendPositiveInteger(
  search: URLSearchParams,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined)
    return

  const normalized = Math.trunc(value)
  if (normalized > 0)
    search.set(key, String(normalized))
}

export async function requestAdminRun<T>(
  url: string,
  options: AdminRunFetchOptions,
  init?: { method?: 'POST', body?: unknown },
): Promise<T> {
  let response: Response

  try {
    response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: options.signal,
    })
  }
  catch (error) {
    if (options.signal?.aborted || isAbortError(error))
      throw error

    throw new AdminRunApiError(
      0,
      () => i18n.global.t('errors.apiUnavailable'),
      { cause: error },
    )
  }

  const payload = await readJson(response)

  if (!response.ok || !isSuccessResponse<T>(payload)) {
    throw new AdminRunApiError(
      response.status,
      getErrorMessageSource(payload, response),
    )
  }

  return payload.data
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  }
  catch {
    return undefined
  }
}

function isSuccessResponse<T>(value: unknown): value is ApiSuccessResponse<T> & { data: T } {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && value.success === true
    && 'data' in value
    && value.data !== null
  )
}

function getErrorMessageSource(payload: unknown, response: Response): AdminRunErrorMessage {
  if (
    typeof payload === 'object'
    && payload !== null
    && 'message' in payload
    && typeof payload.message === 'string'
    && payload.message
  ) {
    return payload.message
  }

  return response.ok
    ? () => i18n.global.t('errors.invalidResponse')
    : () => i18n.global.t('errors.requestFailed', { status: response.status })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
