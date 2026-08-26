import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { getEncoding } from 'js-tiktoken'
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

const tokenizer = getEncoding('cl100k_base')
// js-tiktoken's JavaScript BPE implementation becomes expensive on one very
// long cl100k regex piece, so long pieces use the equivalent heap-based merge.
const MAX_TOKENIZER_EXACT_PIECE_CODE_POINTS = 8_192
export const CL100K_MAX_TOKEN_BYTES = 128
const TOKEN_COUNT_CACHE_LIMIT = 256
const tokenCountCache = new Map<string, number>()
const longTokenCountCache = new Map<string, number>()

export function countArticleTokens(value: string): number {
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

function hasMoreThanCodePoints(value: string, limit: number): boolean {
  let count = 0
  for (const _codePoint of value) {
    count += 1
    if (count > limit)
      return true
  }
  return false
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
