import type { AdminRunPagination } from './admin-run.js'

// 翻译质检站（阶段 A，Issue #109）admin 只读协议。
// A-1 仅覆盖文章列表与术语库浏览；打分与审核字段由 A-2 起填充。

export interface QaArticleListItem {
  id: string
  sourceId: number
  slug: string
  title: string
  /** 已有译文语种数（含 zh 变体） */
  translatedLanguageCount: number
  /** 语言总数基准（快照口径 19） */
  languageTotal: number
  termHitCount: number | null
  isQaCandidate: boolean
  isPublished: boolean
  publishedAt: string | null
}

export interface QaArticleListResponse {
  items: QaArticleListItem[]
  pagination: AdminRunPagination
}

export interface QaGlossaryListItem {
  id: number
  name: string
  description: string | null
  isActive: boolean
  revision: number
  termCount: number
  /** 目标语种数（不含 zh* 源语种，与词条页下拉口径一致） */
  languageCount: number
}

export interface QaGlossaryListResponse {
  items: QaGlossaryListItem[]
}

export interface QaGlossaryTermListItem {
  termId: number
  isActive: boolean
  /** 中文源文本（zh 优先，缺失时回退任一 zh* 变体） */
  sourceText: string | null
  /** 目标语言译文，词条在该语种无翻译时为 null */
  targetText: string | null
}

export interface QaGlossaryTermListResponse {
  glossary: {
    id: number
    name: string
  }
  targetLanguage: string
  /** 该术语库可用目标语种（不含 zh 源语种），供前端下拉 */
  availableLanguages: string[]
  items: QaGlossaryTermListItem[]
  pagination: AdminRunPagination
}

// ---------- A-2（Issue #111）：译文对照详情与动作 ----------

export type QaTranslationVerdict = 'PASS' | 'REVIEW' | 'REJECT'
export type QaReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type QaTranslationTaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface QaTranslationScore {
  ruleScore: number | null
  judgeScore: number | null
  lengthRatio: number | null
  verdict: QaTranslationVerdict | null
  reviewStatus: QaReviewStatus
  reviewNote: string | null
  scoredAt: string | null
  reviewedAt: string | null
}

/** 详情页语种矩阵的每语种摘要 */
export interface QaTranslationSummary {
  languageCode: string
  title: string
  ruleScore: number | null
  verdict: QaTranslationVerdict | null
  reviewStatus: QaReviewStatus | null
  /** 该语种是否有排队中的翻译任务 */
  hasPendingTask: boolean
}

export interface QaArticleDetail {
  id: string
  sourceId: number
  slug: string
  title: string
  summary: string | null
  /** 服务端已按标签白名单净化、移除全部属性的结构化预览 HTML */
  contentHtml: string
  isPublished: boolean
  publishedAt: string | null
  isQaCandidate: boolean
  termHitCount: number | null
  languageTotal: number
  translations: QaTranslationSummary[]
  /** 尚无译文、可发起翻译任务的语种 */
  missingLanguages: string[]
  /** 尚无译文但已有 PENDING 翻译任务的语种 */
  pendingLanguages: string[]
}

export interface QaTranslationDetail {
  languageCode: string
  title: string
  summary: string | null
  /** 服务端已按标签白名单净化、移除全部属性的结构化预览 HTML */
  contentHtml: string
  metaTitle: string | null
  metaDescription: string | null
  score: QaTranslationScore | null
  hasPendingTask: boolean
}

export interface QaScoreResult {
  score: QaTranslationScore
}

export interface QaReviewRequest {
  decision: Extract<QaReviewStatus, 'APPROVED' | 'REJECTED'>
  note?: string
}

export interface QaTranslateTaskResponse {
  taskId: string
  languageCode: string
  status: QaTranslationTaskStatus
  /** 已存在 PENDING 任务时为 true（幂等返回既有任务） */
  alreadyQueued: boolean
}

export interface QaDiagnoseResponse {
  answer: string
  /** A-2 为占位实现；阶段 D 接入 Agent Runtime 后置为 false */
  mock: boolean
}

// ---------- 诊断对话落库（质检工作台重构） ----------

export type QaDiagnoseRole = 'USER' | 'ASSISTANT'

export interface QaDiagnoseMessage {
  id: string
  role: QaDiagnoseRole
  content: string
  createdAt: string
}

export interface QaDiagnoseHistoryResponse {
  items: QaDiagnoseMessage[]
}
