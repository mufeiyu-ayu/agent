import type {
  QaArticleDetail,
  QaArticleListResponse,
  QaDiagnoseResponse,
  QaGlossaryListResponse,
  QaGlossaryTermListResponse,
  QaReviewRequest,
  QaScoreResult,
  QaTranslateTaskResponse,
  QaTranslationDetail,
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

export function fetchQaArticleDetail(
  articleId: string,
  options: AdminRunFetchOptions = {},
): Promise<QaArticleDetail> {
  return requestAdminRun<QaArticleDetail>(
    `/api/admin/qa/articles/${encodeURIComponent(articleId)}`,
    options,
  )
}

export function fetchQaTranslationDetail(
  articleId: string,
  languageCode: string,
  options: AdminRunFetchOptions = {},
): Promise<QaTranslationDetail> {
  return requestAdminRun<QaTranslationDetail>(
    `/api/admin/qa/articles/${encodeURIComponent(articleId)}/translations/${encodeURIComponent(languageCode)}`,
    options,
  )
}

export function scoreQaTranslation(
  articleId: string,
  languageCode: string,
  options: AdminRunFetchOptions = {},
): Promise<QaScoreResult> {
  return requestAdminRun<QaScoreResult>(
    `/api/admin/qa/articles/${encodeURIComponent(articleId)}/translations/${encodeURIComponent(languageCode)}/score`,
    options,
    { method: 'POST' },
  )
}

export function reviewQaTranslation(
  articleId: string,
  languageCode: string,
  body: QaReviewRequest,
  options: AdminRunFetchOptions = {},
): Promise<QaScoreResult> {
  return requestAdminRun<QaScoreResult>(
    `/api/admin/qa/articles/${encodeURIComponent(articleId)}/translations/${encodeURIComponent(languageCode)}/review`,
    options,
    { method: 'POST', body },
  )
}

export function requestQaTranslation(
  articleId: string,
  languageCode: string,
  options: AdminRunFetchOptions = {},
): Promise<QaTranslateTaskResponse> {
  return requestAdminRun<QaTranslateTaskResponse>(
    `/api/admin/qa/articles/${encodeURIComponent(articleId)}/translate`,
    options,
    { method: 'POST', body: { languageCode } },
  )
}

export function diagnoseQaArticle(
  articleId: string,
  question: string,
  options: AdminRunFetchOptions = {},
): Promise<QaDiagnoseResponse> {
  return requestAdminRun<QaDiagnoseResponse>(
    `/api/admin/qa/articles/${encodeURIComponent(articleId)}/diagnose`,
    options,
    { method: 'POST', body: { question } },
  )
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
