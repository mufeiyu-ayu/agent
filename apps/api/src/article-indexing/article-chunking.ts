export {
  ARTICLE_CHUNKER_PROFILE,
  chunkCanonicalArticle,
} from './chunking/deterministic-chunker.js'
export type { DeterministicArticleChunk } from './chunking/deterministic-chunker.js'
export { canonicalizeArticleSource } from './chunking/structural-blocks.js'
export type {
  ArticleSourceSnapshot,
  CanonicalArticleSource,
  CanonicalStructuralBlock,
  CanonicalTableCell,
  HeadingPathItem,
  ListPathItem,
} from './chunking/structural-blocks.js'
export { countArticleTokens } from './chunking/token-counter.js'
