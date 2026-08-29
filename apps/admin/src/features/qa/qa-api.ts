import type {
  QaArticleListResponse,
  QaGlossaryListResponse,
  QaGlossaryTermListResponse,
} from '@agent/contracts'
import type { AdminRunFetchOptions } from '../shared/admin-api'

import { appendPositiveInteger, requestAdminRun } from '../shared/admin-api'

export interface QaArticleListQuery {
  page?: number
  pageSize?: number
  search?: string
  qaCandidateOnly?: boolean
  publishedOnly?: boolean
}

export function fetchQaArticles(
  query: QaArticleListQuery,
  options: AdminRunFetchOptions = {},
): Promise<QaArticleListResponse> {
  const search = new URLSearchParams()

  appendPositiveInteger(search, 'page', query.page)
  appendPositiveInteger(search, 'pageSize', query.pageSize)
  if (query.search?.trim())
    search.set('search', query.search.trim())
  if (query.qaCandidateOnly)
    search.set('qaCandidateOnly', 'true')
  if (query.publishedOnly)
    search.set('publishedOnly', 'true')

  const serialized = search.toString()
  return requestAdminRun<QaArticleListResponse>(
    `/api/admin/qa/articles${serialized ? `?${serialized}` : ''}`,
    options,
  )
}

export function fetchQaGlossaries(
  options: AdminRunFetchOptions = {},
): Promise<QaGlossaryListResponse> {
  return requestAdminRun<QaGlossaryListResponse>('/api/admin/qa/glossaries', options)
}

export interface QaGlossaryTermListQuery {
  page?: number
  pageSize?: number
  search?: string
  targetLanguage?: string
}

export function fetchQaGlossaryTerms(
  glossaryId: number,
  query: QaGlossaryTermListQuery,
  options: AdminRunFetchOptions = {},
): Promise<QaGlossaryTermListResponse> {
  const search = new URLSearchParams()

  appendPositiveInteger(search, 'page', query.page)
  appendPositiveInteger(search, 'pageSize', query.pageSize)
  if (query.search?.trim())
    search.set('search', query.search.trim())
  if (query.targetLanguage)
    search.set('targetLanguage', query.targetLanguage)

  const serialized = search.toString()
  return requestAdminRun<QaGlossaryTermListResponse>(
    `/api/admin/qa/glossaries/${glossaryId}/terms${serialized ? `?${serialized}` : ''}`,
    options,
  )
}
