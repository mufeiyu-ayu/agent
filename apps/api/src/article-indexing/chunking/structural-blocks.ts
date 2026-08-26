import { createHash } from 'node:crypto'
import { load } from 'cheerio'

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

function renderTableRow(cells: readonly CanonicalTableCell[]): string {
  return `| ${cells.map((cell) => {
    const span = cell.colspan === 1 && cell.rowspan === 1
      ? ''
      : ` {colspan=${cell.colspan},rowspan=${cell.rowspan}}`
    return `[${cell.kind === 'header' ? 'H' : 'D'}] ${JSON.stringify(cell.text)}${span}`
  }).join(' | ')} |`
}

function cloneHeadingPath(
  headingPath: readonly HeadingPathItem[],
): HeadingPathItem[] {
  return headingPath.map(item => ({ ...item }))
}

function normalizeText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\s\u200B\u2060]+/gu, ' ')
    .trim()
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
