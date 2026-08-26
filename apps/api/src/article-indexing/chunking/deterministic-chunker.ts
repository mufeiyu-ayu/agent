import type {
  CanonicalArticleSource,
  CanonicalStructuralBlock,
  HeadingPathItem,
} from './structural-blocks.js'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { formatEmbeddingDocumentInput } from '../../embeddings/embedding-formatter.js'
import {
  CL100K_MAX_TOKEN_BYTES,
  countArticleTokens as countTokens,
} from './token-counter.js'

export const ARTICLE_CHUNKER_PROFILE = {
  version: 'article-html-cl100k-v1',
  targetTokens: 600,
  hardMaxTokens: 800,
  overlapTokens: 80,
} as const

const sentenceSegmenter = new Intl.Segmenter('und', {
  granularity: 'sentence',
})

// Keep synchronous tokenizer probes bounded when a sentence has no smaller
// semantic boundary.
const MAX_TOKENIZER_SPLIT_CODE_POINTS = 1_024
export interface DeterministicArticleChunk {
  id: string
  articleId: string
  ordinal: number
  languageCode: string
  sectionPath: string
  content: string
  embeddingInput: string
  tokenCount: number
  overlapTokenCount: number
  contentHash: string
  embeddingInputHash: string
  chunkerVersion: typeof ARTICLE_CHUNKER_PROFILE.version
  embeddingVersion: string
}

interface ChunkUnit {
  headingPath: HeadingPathItem[]
  sectionOccurrence: number
  text: string
}

export function chunkCanonicalArticle(
  source: CanonicalArticleSource,
  embeddingVersion: string,
): DeterministicArticleChunk[] {
  let sectionOccurrence = 0
  const units = source.blocks.flatMap((block): ChunkUnit[] => {
    if (block.kind === 'heading') {
      sectionOccurrence += 1
      return []
    }
    return splitBlockIntoUnits(source, block, sectionOccurrence)
  })
  const chunks: DeterministicArticleChunk[] = []
  let currentBody = ''
  let currentPath: HeadingPathItem[] = []
  let currentSectionOccurrence = 0
  let currentOverlapTokenCount = 0
  let previousBody = ''
  let previousPathKey = ''
  let previousSectionOccurrence = -1

  const flush = (): void => {
    if (!currentBody)
      return

    const ordinal = chunks.length
    const sectionPath = formatSectionPath(currentPath)
    const embeddingInput = formatEmbeddingDocumentInput(
      source.title,
      sectionPath,
      currentBody,
    )
    const tokenCount = countTokens(embeddingInput)

    if (tokenCount > ARTICLE_CHUNKER_PROFILE.hardMaxTokens) {
      throw new Error(
        `chunk input exceeds ${ARTICLE_CHUNKER_PROFILE.hardMaxTokens} tokens`,
      )
    }

    const contentHash = sha256(currentBody)
    const embeddingInputHash = sha256(embeddingInput)
    const id = sha256(JSON.stringify({
      format: 'article-chunk-id-v1',
      articleId: source.articleId,
      chunkerVersion: ARTICLE_CHUNKER_PROFILE.version,
      embeddingVersion,
      ordinal,
      embeddingInputHash,
    }))

    chunks.push({
      id,
      articleId: source.articleId,
      ordinal,
      languageCode: source.languageCode,
      sectionPath,
      content: currentBody,
      embeddingInput,
      tokenCount,
      overlapTokenCount: currentOverlapTokenCount,
      contentHash,
      embeddingInputHash,
      chunkerVersion: ARTICLE_CHUNKER_PROFILE.version,
      embeddingVersion,
    })
    previousBody = currentBody
    previousPathKey = serializeHeadingPath(currentPath)
    previousSectionOccurrence = currentSectionOccurrence
    currentBody = ''
    currentOverlapTokenCount = 0
  }

  for (const unit of units) {
    const unitPathKey = serializeHeadingPath(unit.headingPath)

    if (
      currentBody
      && (
        unitPathKey !== serializeHeadingPath(currentPath)
        || unit.sectionOccurrence !== currentSectionOccurrence
      )
    ) {
      flush()
    }

    if (!currentBody) {
      currentPath = cloneHeadingPath(unit.headingPath)
      currentSectionOccurrence = unit.sectionOccurrence
      const overlap = unitPathKey === previousPathKey
        && unit.sectionOccurrence === previousSectionOccurrence
        ? selectOverlap(source, currentPath, previousBody, unit.text)
        : ''
      currentBody = joinBody(overlap, unit.text)
      currentOverlapTokenCount = overlap ? countTokens(overlap) : 0
      continue
    }

    const candidate = joinBody(currentBody, unit.text)

    if (fitsTokenLimit(
      source,
      currentPath,
      candidate,
      ARTICLE_CHUNKER_PROFILE.targetTokens,
    )) {
      currentBody = candidate
      continue
    }

    flush()
    currentPath = cloneHeadingPath(unit.headingPath)
    currentSectionOccurrence = unit.sectionOccurrence
    const overlap = unitPathKey === previousPathKey
      && unit.sectionOccurrence === previousSectionOccurrence
      ? selectOverlap(source, currentPath, previousBody, unit.text)
      : ''
    currentBody = joinBody(overlap, unit.text)
    currentOverlapTokenCount = overlap ? countTokens(overlap) : 0
  }

  flush()
  return chunks
}

function splitBlockIntoUnits(
  source: CanonicalArticleSource,
  block: Exclude<CanonicalStructuralBlock, { kind: 'heading' }>,
  sectionOccurrence: number,
): ChunkUnit[] {
  const rendered = renderContentBlock(block, block.text)

  if (fitsHardLimit(source, block.headingPath, rendered)) {
    return [{
      headingPath: cloneHeadingPath(block.headingPath),
      sectionOccurrence,
      text: rendered,
    }]
  }

  const units: ChunkUnit[] = []
  let current = ''
  const flush = (): void => {
    const text = normalizeText(current)
    if (!text)
      return
    units.push({
      headingPath: cloneHeadingPath(block.headingPath),
      sectionOccurrence,
      text: renderContentBlock(block, text),
    })
    current = ''
  }

  // Intl.Segmenter exposes a lazy iterable. Keep it lazy: materializing every
  // segment makes one large, many-sentence block consume unbounded memory.
  for (const item of sentenceSegmenter.segment(block.text)) {
    const sentence = normalizeText(item.segment)
    if (!sentence)
      continue

    if (current) {
      // item.segment retains the original separator. This preserves `甲。乙。`
      // instead of inventing a space while still using canonical whitespace.
      const candidate = `${current}${item.segment}`
      if (fitsTokenLimit(
        source,
        block.headingPath,
        renderContentBlock(block, normalizeText(candidate)),
        ARTICLE_CHUNKER_PROFILE.targetTokens,
      )) {
        current = candidate
        continue
      }
      flush()
    }

    if (fitsHardLimit(
      source,
      block.headingPath,
      renderContentBlock(block, sentence),
    )) {
      current = item.segment
      continue
    }

    for (const piece of splitByCodePoint(source, block, sentence)) {
      units.push({
        headingPath: cloneHeadingPath(block.headingPath),
        sectionOccurrence,
        text: renderContentBlock(block, piece),
      })
    }
  }

  flush()
  return units
}

function splitByCodePoint(
  source: CanonicalArticleSource,
  block: Exclude<CanonicalStructuralBlock, { kind: 'heading' }>,
  text: string,
): string[] {
  const codePoints = [...text]
  const pieces: string[] = []
  let offset = 0

  while (offset < codePoints.length) {
    let low = 1
    let high = Math.min(
      MAX_TOKENIZER_SPLIT_CODE_POINTS,
      codePoints.length - offset,
    )
    let best = 0

    const boundedCandidate = codePoints.slice(offset, offset + high).join('')
    if (fitsHardLimit(
      source,
      block.headingPath,
      renderContentBlock(block, boundedCandidate),
    )) {
      best = high
    }

    while (best !== high && low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = codePoints.slice(offset, offset + middle).join('')
      if (fitsHardLimit(
        source,
        block.headingPath,
        renderContentBlock(block, candidate),
      )) {
        best = middle
        low = middle + 1
      }
      else {
        high = middle - 1
      }
    }

    if (best === 0) {
      throw new Error(
        `article metadata prefix leaves no room within ${ARTICLE_CHUNKER_PROFILE.hardMaxTokens} tokens`,
      )
    }

    pieces.push(codePoints.slice(offset, offset + best).join(''))
    offset += best
  }

  return pieces
}

function selectOverlap(
  source: CanonicalArticleSource,
  headingPath: HeadingPathItem[],
  previousBody: string,
  newContent: string,
): string {
  if (!previousBody)
    return ''

  const codePoints = [...previousBody]
  let low = 1
  let high = codePoints.length
  let best = ''

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = codePoints.slice(-middle).join('').trim()
    const candidateBody = joinBody(candidate, newContent)
    const withinOverlap = countTokens(candidate)
      <= ARTICLE_CHUNKER_PROFILE.overlapTokens
    const withinHardLimit = fitsHardLimit(
      source,
      headingPath,
      candidateBody,
    )

    if (candidate && withinOverlap && withinHardLimit) {
      best = candidate
      low = middle + 1
    }
    else {
      high = middle - 1
    }
  }

  return best
}

function renderContentBlock(
  block: Exclude<CanonicalStructuralBlock, { kind: 'heading' }>,
  text: string,
): string {
  let rendered: string
  switch (block.kind) {
    case 'paragraph':
      rendered = text
      break
    case 'blockquote':
      rendered = text
      break
    case 'code':
      rendered = `Code: ${text}`
      break
    case 'figure':
      rendered = `${block.source === 'caption' ? 'Figure' : 'Image'}: ${text}`
      break
    case 'list_item': {
      const indentation = '  '.repeat(block.depth - 1)
      const prefix = `[List ${block.listIndex + 1}] `
      if (block.continuation)
        rendered = `${prefix}${indentation}  ${text}`
      else if (block.listKind === 'ordered')
        rendered = `${prefix}${indentation}${block.itemOrdinal ?? 1}. ${text}`
      else
        rendered = `${prefix}${indentation}- ${text}`
      break
    }
    case 'table_row':
      rendered = `[Table ${block.tableIndex + 1}, row ${block.rowIndex + 1}] ${text}`
      break
    case 'table_caption':
      rendered = `[Table ${block.tableIndex + 1}, caption] ${text}`
      break
  }

  if (block.listPath) {
    const path = block.listPath.map(item => [
      `L${item.listIndex + 1}`,
      item.listKind,
      `item=${item.itemPosition}`,
      `ordinal=${item.itemOrdinal ?? '-'}`,
    ].join(':')).join('>')
    rendered = `[In ${path}] ${rendered}`
  }

  const quoteDepth = block.quoteDepth
    ?? (block.kind === 'blockquote' ? 1 : 0)
  if (quoteDepth === 0)
    return rendered
  const prefix = '> '.repeat(quoteDepth)
  return rendered.split('\n').map(line => `${prefix}${line}`).join('\n')
}

function fitsHardLimit(
  source: CanonicalArticleSource,
  headingPath: HeadingPathItem[],
  body: string,
): boolean {
  return fitsTokenLimit(
    source,
    headingPath,
    body,
    ARTICLE_CHUNKER_PROFILE.hardMaxTokens,
  )
}

function fitsTokenLimit(
  source: CanonicalArticleSource,
  headingPath: HeadingPathItem[],
  body: string,
  tokenLimit: number,
): boolean {
  const input = formatEmbeddingDocumentInput(
    source.title,
    formatSectionPath(headingPath),
    body,
  )
  if (Buffer.byteLength(input, 'utf8') > tokenLimit * CL100K_MAX_TOKEN_BYTES)
    return false
  return countTokens(input) <= tokenLimit
}

function formatSectionPath(headingPath: readonly HeadingPathItem[]): string {
  return headingPath
    .map(item => `H${item.level}: ${JSON.stringify(item.text)}`)
    .join(' > ')
}

function serializeHeadingPath(headingPath: readonly HeadingPathItem[]): string {
  return JSON.stringify(headingPath)
}

function cloneHeadingPath(
  headingPath: readonly HeadingPathItem[],
): HeadingPathItem[] {
  return headingPath.map(item => ({ ...item }))
}

function joinBody(left: string, right: string): string {
  return left && right ? `${left}\n\n${right}` : left || right
}

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\s\u200B\u2060]+/gu, ' ')
    .trim()
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
