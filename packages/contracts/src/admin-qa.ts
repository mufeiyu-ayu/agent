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
