import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { load } from 'cheerio'
import { getEncoding } from 'js-tiktoken'
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

export const ARTICLE_CHUNKER_PROFILE = {
  version: 'article-html-cl100k-v1',
  targetTokens: 600,
  hardMaxTokens: 800,
  overlapTokens: 80,
} as const

const tokenizer = getEncoding('cl100k_base')
const sentenceSegmenter = new Intl.Segmenter('und', {
  granularity: 'sentence',
})

// js-tiktoken's JavaScript BPE implementation becomes expensive on one very
// long cl100k regex piece. Body fallback uses small bounded windows; long
// metadata pieces use the equivalent heap-based merge below.
const MAX_TOKENIZER_SPLIT_CODE_POINTS = 1_024
const MAX_TOKENIZER_EXACT_PIECE_CODE_POINTS = 8_192
const CL100K_MAX_TOKEN_BYTES = 128
const TOKEN_COUNT_CACHE_LIMIT = 256
const tokenCountCache = new Map<string, number>()
const longTokenCountCache = new Map<string, number>()

const EXCLUDED_ELEMENTS = new Set([
  'canvas',
  'head',
  'iframe',
  'noscript',
  'script',
  'style',
  'svg',
  'template',
])

const BLOCK_ELEMENTS = new Set([
  ...EXCLUDED_ELEMENTS,
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'code',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'html',
  'hr',
  'img',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tr',
  'ul',
])

const TEXT_BOUNDARY_ELEMENTS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'code',
  'dd',
  'details',
  'div',
  'dt',
  'figcaption',
  'footer',
  'header',
  'main',
  'nav',
  'p',
  'pre',
  'section',
  'summary',
])

const LIST_ITEM_STRUCTURAL_ELEMENTS = new Set([
  'blockquote',
  'code',
  'figure',
  'figcaption',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'pre',
  'table',
  'tr',
])

export interface ArticleSourceSnapshot {
  id: string
  sourceId: number
  title: string
  languageCode: string
  content: string
  updatedAt: Date
}

export interface HeadingPathItem {
  level: number
  text: string
}

export interface ListPathItem {
  listIndex: number
  listKind: 'ordered' | 'unordered'
  itemPosition: number
  itemOrdinal: number | null
}

interface CanonicalBlockBase {
  headingPath: HeadingPathItem[]
  text: string
  quoteDepth?: number
  listPath?: ListPathItem[]
}

export type CanonicalStructuralBlock
  = | (CanonicalBlockBase & {
    kind: 'heading'
    level: number
  })
  | (CanonicalBlockBase & {
    kind: 'paragraph' | 'blockquote' | 'code'
  })
  | (CanonicalBlockBase & {
    kind: 'figure'
    source: 'alt' | 'caption'
  })
  | (CanonicalBlockBase & {
    kind: 'list_item'
    listIndex: number
    listKind: 'ordered' | 'unordered'
    depth: number
    itemOrdinal: number | null
    continuation: boolean
  })
  | (CanonicalBlockBase & {
    kind: 'table_row'
    tableIndex: number
    rowIndex: number
    cells: CanonicalTableCell[]
  })
  | (CanonicalBlockBase & {
    kind: 'table_caption'
    tableIndex: number
  })

export interface CanonicalTableCell {
  kind: 'header' | 'data'
  text: string
  colspan: number
  rowspan: number
}

export interface CanonicalArticleSource {
  articleId: string
  sourceId: number
  title: string
  languageCode: string
  blocks: CanonicalStructuralBlock[]
  sourceHash: string
  sourceUpdatedAt: Date
}

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

interface HtmlNode {
  type?: string
  name?: string
  data?: string
  attribs?: Record<string, string | undefined>
  children?: HtmlNode[]
}

interface ExtractionState {
  blocks: CanonicalStructuralBlock[]
  headingPath: HeadingPathItem[]
  nextListIndex: number
  nextTableIndex: number
  quoteDepth: number
  listPath: ListPathItem[]
}

interface ChunkUnit {
  headingPath: HeadingPathItem[]
  sectionOccurrence: number
  text: string
}

export function canonicalizeArticleSource(
  source: ArticleSourceSnapshot,
): CanonicalArticleSource {
  const title = normalizeText(source.title)
  const languageCode = normalizeText(source.languageCode)
  const blocks = extractStructuralBlocks(source.content)
  const serialization = JSON.stringify({
    format: 'article-canonical-source-v1',
    title,
    languageCode,
    blocks,
  })

  return {
    articleId: source.id,
    sourceId: source.sourceId,
    title,
    languageCode,
    blocks,
    sourceHash: sha256(serialization),
    sourceUpdatedAt: source.updatedAt,
  }
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
    const embeddingInput = formatEmbeddingInput(
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

export function countArticleTokens(value: string): number {
  return countTokens(value)
}

export function formatEmbeddingInput(
  title: string,
  sectionPath: string,
  body: string,
): string {
  return sectionPath
    ? `Article: ${title}\nSection: ${sectionPath}\n\n${body}`
    : `Article: ${title}\n\n${body}`
}

function extractStructuralBlocks(content: string): CanonicalStructuralBlock[] {
  const $ = load(content, {}, false)
  const state: ExtractionState = {
    blocks: [],
    headingPath: [],
    nextListIndex: 0,
    nextTableIndex: 0,
    quoteDepth: 0,
    listPath: [],
  }
  const nodes = $.root().contents().toArray() as unknown as HtmlNode[]

  visitContainer(nodes, state)
  return state.blocks
}

function visitContainer(nodes: readonly HtmlNode[], state: ExtractionState): void {
  let inlineNodes: HtmlNode[] = []
  const flushInline = (): void => {
    const text = collectText(inlineNodes)
    inlineNodes = []
    pushTextBlock(state, 'paragraph', text)
  }

  for (const node of nodes) {
    const name = elementName(node)

    if (name && EXCLUDED_ELEMENTS.has(name))
      continue

    if (!name || !BLOCK_ELEMENTS.has(name)) {
      if (name && containsBlockElement(node)) {
        flushInline()
        visitContainer(node.children ?? [], state)
        continue
      }
      inlineNodes.push(node)
      continue
    }

    flushInline()
    visitBlock(node, name, state)
  }

  flushInline()
}

function visitBlock(
  node: HtmlNode,
  name: string,
  state: ExtractionState,
): void {
  if (EXCLUDED_ELEMENTS.has(name) || name === 'hr')
    return

  if (/^h[1-6]$/.test(name)) {
    const text = collectText([node])
    if (!text)
      return

    const level = Number(name.slice(1))
    state.headingPath = [
      ...state.headingPath.filter(item => item.level < level),
      { level, text },
    ]
    state.blocks.push({
      kind: 'heading',
      level,
      headingPath: cloneHeadingPath(state.headingPath),
      text,
      ...blockContextMetadata(state),
    })
    return
  }

  switch (name) {
    case 'p':
    case 'dt':
    case 'dd':
    case 'summary':
    case 'address':
      pushTextBlock(state, 'paragraph', collectText([node]))
      return

    case 'blockquote': {
      const outerHeadingPath = state.headingPath
      state.quoteDepth += 1
      try {
        visitContainer(node.children ?? [], state)
      }
      finally {
        state.quoteDepth -= 1
        state.headingPath = outerHeadingPath
      }
      return
    }

    case 'pre':
    case 'code':
      pushTextBlock(state, 'code', collectText([node]))
      return

    case 'figure':
      visitFigure(node, state)
      return

    case 'figcaption':
    case 'img':
      pushFigureBlock(state, node, name)
      return

    case 'ol':
    case 'ul':
      visitList(node, name === 'ol' ? 'ordered' : 'unordered', 1, state)
      return

    case 'li': {
      const listIndex = hasMeaningfulListItemContent(node)
        ? state.nextListIndex++
        : -1
      visitListItem(node, 'unordered', 1, listIndex, 1, 1, state)
      return
    }

    case 'table':
      visitTable(node, state)
      return

    case 'tr': {
      if (pushTableRow(node, state.nextTableIndex, 0, state))
        state.nextTableIndex += 1
      return
    }

    default:
      visitContainer(node.children ?? [], state)
  }
}

function visitList(
  node: HtmlNode,
  listKind: 'ordered' | 'unordered',
  depth: number,
  state: ExtractionState,
): void {
  const items = findListItems(node.children ?? [])
  const listIndex = items.some(hasMeaningfulListItemContent)
    ? state.nextListIndex++
    : -1
  const reversed = listKind === 'ordered'
    && node.attribs !== undefined
    && Object.hasOwn(node.attribs, 'reversed')
  const step = reversed ? -1 : 1
  const start = listKind === 'ordered'
    ? integer(node.attribs?.start, reversed ? items.length : 1)
    : 1
  let nextOrdinal = start

  for (const [itemIndex, child] of items.entries()) {
    const itemOrdinal = listKind === 'ordered'
      ? integer(child.attribs?.value, nextOrdinal)
      : null
    visitListItem(
      child,
      listKind,
      depth,
      listIndex,
      itemIndex + 1,
      itemOrdinal,
      state,
    )
    if (itemOrdinal !== null)
      nextOrdinal = itemOrdinal + step
  }
}

function visitListItem(
  node: HtmlNode,
  listKind: 'ordered' | 'unordered',
  depth: number,
  listIndex: number,
  itemPosition: number,
  itemOrdinal: number | null,
  state: ExtractionState,
): void {
  let segmentNodes: HtmlNode[] = []
  let continuation = false
  const outerHeadingPath = state.headingPath
  const listContext: ListPathItem = {
    listIndex,
    listKind,
    itemPosition,
    itemOrdinal,
  }

  const flushSegment = (): void => {
    const text = collectText(segmentNodes)
    segmentNodes = []
    if (!text)
      return
    if (listIndex < 0)
      throw new Error('non-empty list item is missing stable list identity')

    state.blocks.push({
      kind: 'list_item',
      headingPath: cloneHeadingPath(state.headingPath),
      text,
      listIndex,
      listKind,
      depth,
      itemOrdinal,
      continuation,
      ...blockContextMetadata(state),
    })
  }

  const visitStructuredChild = (child: HtmlNode, name: string): void => {
    const outerListPath = state.listPath
    state.listPath = [...outerListPath, listContext]
    try {
      if (name === 'ol' || name === 'ul')
        visitList(child, name === 'ol' ? 'ordered' : 'unordered', depth + 1, state)
      else
        visitBlock(child, name, state)
    }
    finally {
      state.listPath = outerListPath
    }
  }

  const visit = (child: HtmlNode): void => {
    const name = elementName(child)
    if (name && EXCLUDED_ELEMENTS.has(name))
      return
    if (name === 'ol' || name === 'ul') {
      flushSegment()
      visitStructuredChild(child, name)
      continuation = true
      return
    }
    if (name && LIST_ITEM_STRUCTURAL_ELEMENTS.has(name)) {
      flushSegment()
      visitStructuredChild(child, name)
      continuation = true
      return
    }
    if (containsListItemStructuralElement(child)) {
      const boundary = name !== undefined && TEXT_BOUNDARY_ELEMENTS.has(name)
      if (boundary)
        segmentNodes.push(textNode(' '))
      for (const nested of child.children ?? [])
        visit(nested)
      if (boundary)
        segmentNodes.push(textNode(' '))
      return
    }
    segmentNodes.push(child)
  }

  try {
    for (const child of node.children ?? [])
      visit(child)
    flushSegment()
  }
  finally {
    state.headingPath = outerHeadingPath
  }
}

function visitTable(
  node: HtmlNode,
  state: ExtractionState,
): void {
  const tableIndex = state.nextTableIndex
  const firstBlockIndex = state.blocks.length
  let rowIndex = 0
  const visit = (children: readonly HtmlNode[]): void => {
    for (const child of children) {
      const name = elementName(child)
      if ((name && EXCLUDED_ELEMENTS.has(name)) || name === 'table')
        continue
      if (name === 'caption') {
        const text = collectText([child])
        if (text) {
          state.blocks.push({
            kind: 'table_caption',
            headingPath: cloneHeadingPath(state.headingPath),
            text,
            tableIndex,
            ...blockContextMetadata(state),
          })
        }
        continue
      }
      if (name === 'tr') {
        if (pushTableRow(child, tableIndex, rowIndex, state))
          rowIndex += 1
        continue
      }
      visit(child.children ?? [])
    }
  }

  visit(node.children ?? [])
  if (state.blocks.length > firstBlockIndex)
    state.nextTableIndex += 1
}

function pushTableRow(
  node: HtmlNode,
  tableIndex: number,
  rowIndex: number,
  state: ExtractionState,
): boolean {
  const cells = (node.children ?? [])
    .filter(child => ['td', 'th'].includes(elementName(child) ?? ''))
    .map((cell): CanonicalTableCell => ({
      kind: elementName(cell) === 'th' ? 'header' : 'data',
      text: collectText([cell]),
      colspan: positiveInteger(cell.attribs?.colspan, 1),
      rowspan: nonNegativeInteger(cell.attribs?.rowspan, 1),
    }))

  if (cells.length === 0 || cells.every(cell => !cell.text))
    return false

  state.blocks.push({
    kind: 'table_row',
    headingPath: cloneHeadingPath(state.headingPath),
    text: renderTableRow(cells),
    tableIndex,
    rowIndex,
    cells,
    ...blockContextMetadata(state),
  })
  return true
}

function pushFigureBlock(
  state: ExtractionState,
  node: HtmlNode,
  name: 'figcaption' | 'img',
): void {
  const text = name === 'figcaption'
    ? collectText([node])
    : normalizeText(node.attribs?.alt ?? '')
  if (!text)
    return

  state.blocks.push({
    kind: 'figure',
    source: name === 'figcaption' ? 'caption' : 'alt',
    headingPath: cloneHeadingPath(state.headingPath),
    text,
    ...blockContextMetadata(state),
  })
}

function visitFigure(node: HtmlNode, state: ExtractionState): void {
  const hasCaption = findAll(
    node,
    child => elementName(child) === 'figcaption',
  ).some(caption => Boolean(collectText([caption])))
  const children = hasCaption
    ? stripElements(node.children ?? [], 'img')
    : node.children ?? []

  visitContainer(children, state)
}

function stripElements(
  nodes: readonly HtmlNode[],
  element: string,
): HtmlNode[] {
  return nodes.flatMap((node) => {
    if (elementName(node) === element)
      return []
    if (!node.children)
      return [node]
    return [{
      ...node,
      children: stripElements(node.children, element),
    }]
  })
}

function pushTextBlock(
  state: ExtractionState,
  kind: 'paragraph' | 'blockquote' | 'code',
  text: string,
): void {
  if (!text)
    return

  const effectiveKind = kind === 'paragraph' && state.quoteDepth > 0
    ? 'blockquote'
    : kind
  state.blocks.push({
    kind: effectiveKind,
    headingPath: cloneHeadingPath(state.headingPath),
    text,
    ...blockContextMetadata(state, effectiveKind === 'blockquote'),
  })
}

function blockContextMetadata(
  state: ExtractionState,
  blockquoteKind = false,
): { quoteDepth?: number, listPath?: ListPathItem[] } {
  const quoteDepth = state.quoteDepth === 0
    || (blockquoteKind && state.quoteDepth === 1)
    ? {}
    : { quoteDepth: state.quoteDepth }
  const listPath = state.listPath.length === 0
    ? {}
    : { listPath: state.listPath.map(item => ({ ...item })) }
  return { ...quoteDepth, ...listPath }
}

function collectText(
  nodes: readonly HtmlNode[],
  excludedElements: ReadonlySet<string> = EXCLUDED_ELEMENTS,
): string {
  const parts: string[] = []
  const visit = (node: HtmlNode): void => {
    const name = elementName(node)
    if (name && excludedElements.has(name))
      return
    if (node.type === 'text' && typeof node.data === 'string') {
      parts.push(node.data)
      return
    }
    if (name === 'br') {
      parts.push(' ')
      return
    }
    if (name === 'img') {
      const alt = node.attribs?.alt
      if (alt)
        parts.push(` ${alt} `)
      return
    }
    const hasTextBoundary = name !== undefined
      && TEXT_BOUNDARY_ELEMENTS.has(name)
    if (hasTextBoundary)
      parts.push(' ')
    for (const child of node.children ?? [])
      visit(child)
    if (hasTextBoundary)
      parts.push(' ')
  }

  for (const node of nodes)
    visit(node)
  return normalizeText(parts.join(''))
}

function hasMeaningfulListItemContent(node: HtmlNode): boolean {
  return Boolean(collectText(node.children ?? []))
}

function containsListItemStructuralElement(node: HtmlNode): boolean {
  return (node.children ?? []).some((child) => {
    const name = elementName(child)
    if (name && EXCLUDED_ELEMENTS.has(name))
      return false
    return (name !== undefined && (
      name === 'ol'
      || name === 'ul'
      || LIST_ITEM_STRUCTURAL_ELEMENTS.has(name)
    )) || containsListItemStructuralElement(child)
  })
}

function findListItems(nodes: readonly HtmlNode[]): HtmlNode[] {
  return nodes.flatMap((node) => {
    const name = elementName(node)
    if (name && EXCLUDED_ELEMENTS.has(name))
      return []
    if (name === 'li')
      return [node]
    if (name === 'ol' || name === 'ul')
      return []
    return findListItems(node.children ?? [])
  })
}

function textNode(data: string): HtmlNode {
  return { type: 'text', data }
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

function renderTableRow(cells: readonly CanonicalTableCell[]): string {
  return `| ${cells.map((cell) => {
    const span = cell.colspan === 1 && cell.rowspan === 1
      ? ''
      : ` {colspan=${cell.colspan},rowspan=${cell.rowspan}}`
    return `[${cell.kind === 'header' ? 'H' : 'D'}] ${JSON.stringify(cell.text)}${span}`
  }).join(' | ')} |`
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
  const input = formatEmbeddingInput(
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

function countTokens(value: string): number {
  let total = 0
  for (const match of value.matchAll(new RegExp(cl100kBase.pat_str, 'gu'))) {
    if (hasMoreThanCodePoints(match[0], MAX_TOKENIZER_EXACT_PIECE_CODE_POINTS)) {
      const cacheKey = sha256(match[0])
      let count = longTokenCountCache.get(cacheKey)
      if (count === undefined) {
        count = countLongBpePiece(match[0])
        if (longTokenCountCache.size >= TOKEN_COUNT_CACHE_LIMIT)
          longTokenCountCache.clear()
        longTokenCountCache.set(cacheKey, count)
      }
      total += count
      continue
    }

    let count = tokenCountCache.get(match[0])
    if (count === undefined) {
      count = tokenizer.encode(match[0], [], []).length
      if (tokenCountCache.size >= TOKEN_COUNT_CACHE_LIMIT)
        tokenCountCache.clear()
      tokenCountCache.set(match[0], count)
    }
    total += count
  }
  return total
}

interface BpePart {
  start: number
  end: number
  previous: number
  next: number
  version: number
  alive: boolean
}

interface BpeMerge {
  rank: number
  left: number
  right: number
  leftVersion: number
  rightVersion: number
  start: number
}

let cl100kRanks: Map<string, number> | undefined

function countLongBpePiece(value: string): number {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length === 0)
    return 0

  const ranks = getCl100kRanks()
  const parts: BpePart[] = Array.from({ length: bytes.length }, (_, index) => ({
    start: index,
    end: index + 1,
    previous: index - 1,
    next: index + 1 < bytes.length ? index + 1 : -1,
    version: 0,
    alive: true,
  }))
  const heap: BpeMerge[] = []
  const enqueue = (leftIndex: number, rightIndex: number): void => {
    if (leftIndex < 0 || rightIndex < 0)
      return
    const left = parts[leftIndex]!
    const right = parts[rightIndex]!
    const rank = ranks.get(bytes.subarray(left.start, right.end).join(','))
    if (rank === undefined)
      return
    pushBpeMerge(heap, {
      rank,
      left: leftIndex,
      right: rightIndex,
      leftVersion: left.version,
      rightVersion: right.version,
      start: left.start,
    })
  }

  for (let index = 0; index + 1 < parts.length; index += 1)
    enqueue(index, index + 1)

  let count = parts.length
  while (heap.length > 0) {
    const candidate = popBpeMerge(heap)!
    const left = parts[candidate.left]!
    const right = parts[candidate.right]!
    if (
      !left.alive
      || !right.alive
      || left.next !== candidate.right
      || left.version !== candidate.leftVersion
      || right.version !== candidate.rightVersion
    ) {
      continue
    }

    const previous = left.previous
    const next = right.next
    left.end = right.end
    left.next = next
    left.version += 1
    right.alive = false
    right.version += 1
    if (next >= 0)
      parts[next]!.previous = candidate.left
    count -= 1

    enqueue(previous, candidate.left)
    enqueue(candidate.left, next)
  }

  return count
}

function getCl100kRanks(): Map<string, number> {
  if (cl100kRanks)
    return cl100kRanks

  const ranks = new Map<string, number>()
  for (const line of cl100kBase.bpe_ranks.split('\n')) {
    if (!line)
      continue
    const [, offsetText, ...tokens] = line.split(' ')
    const offset = Number.parseInt(offsetText!, 10)
    for (const [index, token] of tokens.entries())
      ranks.set(Buffer.from(token, 'base64').join(','), offset + index)
  }
  cl100kRanks = ranks
  return ranks
}

function pushBpeMerge(heap: BpeMerge[], candidate: BpeMerge): void {
  heap.push(candidate)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (compareBpeMerge(heap[parent]!, candidate) <= 0)
      break
    heap[index] = heap[parent]!
    index = parent
  }
  heap[index] = candidate
}

function popBpeMerge(heap: BpeMerge[]): BpeMerge | undefined {
  const first = heap[0]
  const last = heap.pop()
  if (!first || !last || heap.length === 0)
    return first

  let index = 0
  while (true) {
    const left = index * 2 + 1
    const right = left + 1
    if (left >= heap.length)
      break
    const child = right < heap.length
      && compareBpeMerge(heap[right]!, heap[left]!) < 0
      ? right
      : left
    if (compareBpeMerge(last, heap[child]!) <= 0)
      break
    heap[index] = heap[child]!
    index = child
  }
  heap[index] = last
  return first
}

function compareBpeMerge(left: BpeMerge, right: BpeMerge): number {
  return left.rank - right.rank || left.start - right.start
}

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\s\u200B\u2060]+/gu, ' ')
    .trim()
}

function hasMoreThanCodePoints(value: string, limit: number): boolean {
  let count = 0
  for (const _codePoint of value) {
    count += 1
    if (count > limit)
      return true
  }
  return false
}

function elementName(node: HtmlNode): string | undefined {
  return typeof node.name === 'string' ? node.name.toLowerCase() : undefined
}

function containsBlockElement(node: HtmlNode): boolean {
  return (node.children ?? []).some((child) => {
    const name = elementName(child)
    if (name && EXCLUDED_ELEMENTS.has(name))
      return false
    return (name !== undefined && BLOCK_ELEMENTS.has(name))
      || containsBlockElement(child)
  })
}

function findAll(
  node: HtmlNode,
  predicate: (node: HtmlNode) => boolean,
): HtmlNode[] {
  const matches: HtmlNode[] = []
  const visit = (child: HtmlNode): void => {
    const name = elementName(child)
    if (name && EXCLUDED_ELEMENTS.has(name))
      return
    if (predicate(child))
      matches.push(child)
    for (const nested of child.children ?? [])
      visit(nested)
  }
  visit(node)
  return matches
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value))
    return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value))
    return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function integer(value: string | undefined, fallback: number): number {
  if (!value || !/^-?\d+$/.test(value))
    return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
