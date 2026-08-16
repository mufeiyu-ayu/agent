import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type {
  DatabaseArticleRetrievalExecutionContext,
  NormalizedArticleRetrievalQuery,
} from './article-retrieval.js'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

import { ARTICLE_CHUNKER_PROFILE } from '../article-indexing/article-chunking.js'
import { ACTIVE_EMBEDDING_PROFILE } from '../embeddings/embedding-provider.js'

export const LEXICAL_ARTICLE_CANDIDATE_LIMIT = 10
export const VECTOR_CHUNK_CANDIDATE_LIMIT = 40

const PG_POOL_ACQUISITION_TIMEOUT_MS = 2_000
const PG_CANCEL_TIMEOUT_MS = 2_000
const PG_STATEMENT_TIMEOUT_LEAD_MS = 50
const PG_LOCK_TIMEOUT_LEAD_MS = 25
const require = createRequire(import.meta.url)
const { Pool: PgPool } = require('pg') as {
  Pool: new (options: {
    connectionString: string
    max: number
    connectionTimeoutMillis: number
    query_timeout?: number
    statement_timeout?: number
  }) => NativeArticleRetrievalPool
}

export interface LexicalArticleCandidate {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  seoTitle: string | null
  seoDescription: string | null
  content: string
}

export interface VectorChunkCandidate {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  seoTitle: string | null
  seoDescription: string | null
  chunkId: string
  ordinal: number
  sectionPath: string
  chunkContent: string
  cosineDistance: number
}

export interface ArticleRetrievalRepositoryContract {
  findLexicalCandidates: (
    query: NormalizedArticleRetrievalQuery,
    context: DatabaseArticleRetrievalExecutionContext,
  ) => Promise<LexicalArticleCandidate[]>
  findVectorChunkCandidates: (
    vector: readonly number[],
    query: NormalizedArticleRetrievalQuery,
    context: DatabaseArticleRetrievalExecutionContext,
    onSqlLatencyMs?: (latencyMs: number) => void,
  ) => Promise<VectorChunkCandidate[]>
}

export interface ArticleRetrievalPool {
  connect: () => Promise<ArticleRetrievalPoolClient>
  cancel: (processId: number) => Promise<boolean>
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<PgQueryResult<Row>>
  end: () => Promise<void>
}

interface NativeArticleRetrievalPool {
  connect: () => Promise<ArticleRetrievalPoolClient>
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<PgQueryResult<Row>>
  end: () => Promise<void>
}

export interface ArticleRetrievalPoolClient {
  readonly processID?: number
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<PgQueryResult<Row>>
  release: (error?: Error) => void
}

interface PgQueryResult<Row> {
  rows: Row[]
}

interface LexicalCandidateRow {
  source_id: number
  slug: string
  language_code: string
  title: string
  seo_title: string | null
  seo_description: string | null
  content: string
}

interface VectorCandidateRow {
  source_id: number
  slug: string
  language_code: string
  title: string
  seo_title: string | null
  seo_description: string | null
  chunk_id: string
  ordinal: number
  section_path: string
  chunk_content: string
  cosine_distance: number | string
}

const LEXICAL_CANDIDATES_SQL = String.raw`
  SELECT
    article."sourceId" AS source_id,
    article."slug" AS slug,
    article."languageCode" AS language_code,
    article."title" AS title,
    article."seoTitle" AS seo_title,
    article."seoDescription" AS seo_description,
    article."content" AS content
  FROM "Article" AS article
  WHERE ($3::text IS NULL OR article."languageCode" = $3::text)
    AND (
      article."title" ILIKE $2::text ESCAPE E'\\'
      OR article."slug" ILIKE $2::text ESCAPE E'\\'
      OR article."seoTitle" ILIKE $2::text ESCAPE E'\\'
      OR article."seoDescription" ILIKE $2::text ESCAPE E'\\'
      OR article."content" ILIKE $2::text ESCAPE E'\\'
    )
  ORDER BY
    CASE
      WHEN LOWER(article."title") = LOWER($1::text) THEN 1
      WHEN article."title" ILIKE $2::text ESCAPE E'\\'
        OR article."slug" ILIKE $2::text ESCAPE E'\\'
        OR article."seoTitle" ILIKE $2::text ESCAPE E'\\' THEN 2
      WHEN article."seoDescription" ILIKE $2::text ESCAPE E'\\' THEN 3
      ELSE 4
    END ASC,
    article."sourceId" ASC
  LIMIT 10
`

const VECTOR_CANDIDATES_SQL = `
  WITH compatible_chunks AS (
    SELECT
      article."sourceId" AS source_id,
      article."slug" AS slug,
      article."languageCode" AS language_code,
      article."title" AS title,
      article."seoTitle" AS seo_title,
      article."seoDescription" AS seo_description,
      chunk."id" AS chunk_id,
      chunk."ordinal" AS ordinal,
      chunk."sectionPath" AS section_path,
      chunk."content" AS chunk_content,
      chunk."embedding" <=> $1::vector AS cosine_distance,
      state."chunkCount" AS declared_chunk_count,
      chunk_counts.actual_chunk_count AS actual_chunk_count,
      COUNT(*) OVER (PARTITION BY chunk."articleId") AS compatible_chunk_count
    FROM "ArticleChunk" AS chunk
    INNER JOIN "ArticleIndexState" AS state
      ON state."articleId" = chunk."articleId"
    INNER JOIN "Article" AS article
      ON article."id" = chunk."articleId"
    INNER JOIN (
      SELECT "articleId", COUNT(*) AS actual_chunk_count
      FROM "ArticleChunk"
      GROUP BY "articleId"
    ) AS chunk_counts
      ON chunk_counts."articleId" = chunk."articleId"
    WHERE state."chunkerVersion" = $2::text
      AND state."embeddingVersion" = $3::text
      AND state."sourceUpdatedAt" = article."updatedAt"
      AND state."chunkCount" > 0
      AND chunk."chunkerVersion" = $2::text
      AND chunk."embeddingVersion" = $3::text
      AND chunk."embeddingProvider" = $4::text
      AND chunk."embeddingModel" = $5::text
      AND chunk."embeddingDimensions" = $6::integer
      AND chunk."languageCode" = article."languageCode"
      AND ($7::text IS NULL OR article."languageCode" = $7::text)
  )
  SELECT
    source_id,
    slug,
    language_code,
    title,
    seo_title,
    seo_description,
    chunk_id,
    ordinal,
    section_path,
    chunk_content,
    cosine_distance
  FROM compatible_chunks
  WHERE actual_chunk_count = declared_chunk_count::bigint
    AND compatible_chunk_count = declared_chunk_count::bigint
  ORDER BY
    cosine_distance ASC,
    source_id ASC,
    ordinal ASC,
    chunk_id ASC
  LIMIT 40
`

const SET_LOCAL_TIMEOUTS_SQL = `
  SELECT
    set_config('statement_timeout', $1::text, true),
    set_config('lock_timeout', $2::text, true)
`

export class PostgresArticleRetrievalRepository implements ArticleRetrievalRepositoryContract {
  constructor(private readonly pool: ArticleRetrievalPool) {}

  async findLexicalCandidates(
    query: NormalizedArticleRetrievalQuery,
    context: DatabaseArticleRetrievalExecutionContext,
  ): Promise<LexicalArticleCandidate[]> {
    const literalPattern = escapeLikePattern(query.query)
    const rows = await runOwnedReadQuery<LexicalCandidateRow>(
      this.pool,
      LEXICAL_CANDIDATES_SQL,
      [query.query, `%${literalPattern}%`, query.languageCode ?? null],
      context,
    )

    return rows.map(row => ({
      sourceId: row.source_id,
      slug: row.slug,
      languageCode: row.language_code,
      title: row.title,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      content: row.content,
    }))
  }

  async findVectorChunkCandidates(
    vector: readonly number[],
    query: NormalizedArticleRetrievalQuery,
    context: DatabaseArticleRetrievalExecutionContext,
    onSqlLatencyMs?: (latencyMs: number) => void,
  ): Promise<VectorChunkCandidate[]> {
    validateQueryVector(vector)
    const rows = await runOwnedReadQuery<VectorCandidateRow>(
      this.pool,
      VECTOR_CANDIDATES_SQL,
      [
        `[${vector.join(',')}]`,
        ARTICLE_CHUNKER_PROFILE.version,
        ACTIVE_EMBEDDING_PROFILE.version,
        ACTIVE_EMBEDDING_PROFILE.provider,
        ACTIVE_EMBEDDING_PROFILE.model,
        ACTIVE_EMBEDDING_PROFILE.dimensions,
        query.languageCode ?? null,
      ],
      context,
      onSqlLatencyMs,
    )

    return rows.map((row) => {
      const cosineDistance = Number(row.cosine_distance)
      if (!Number.isFinite(cosineDistance))
        throw new Error('Vector retrieval returned an invalid cosine distance')

      return {
        sourceId: row.source_id,
        slug: row.slug,
        languageCode: row.language_code,
        title: row.title,
        seoTitle: row.seo_title,
        seoDescription: row.seo_description,
        chunkId: row.chunk_id,
        ordinal: row.ordinal,
        sectionPath: row.section_path,
        chunkContent: row.chunk_content,
        cosineDistance,
      }
    })
  }
}

export function createArticleRetrievalPool(
  connectionString: string,
): ArticleRetrievalPool {
  const queryPool = new PgPool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: PG_POOL_ACQUISITION_TIMEOUT_MS,
  })
  const cancellationPool = new PgPool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: PG_POOL_ACQUISITION_TIMEOUT_MS,
    query_timeout: PG_CANCEL_TIMEOUT_MS,
    statement_timeout: PG_CANCEL_TIMEOUT_MS,
  })

  return {
    connect: async () => await queryPool.connect(),
    cancel: async (processId) => {
      const result = await cancellationPool.query<{ cancelled: boolean }>(
        'SELECT pg_cancel_backend($1::integer) AS cancelled',
        [processId],
      )
      return result.rows[0]?.cancelled === true
    },
    query: async <Row>(text: string, values?: unknown[]) => (
      await queryPool.query<Row>(text, values)
    ),
    end: async () => {
      await Promise.all([
        queryPool.end(),
        cancellationPool.end(),
      ])
    },
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

function validateQueryVector(vector: readonly number[]): void {
  if (
    vector.length !== ACTIVE_EMBEDDING_PROFILE.dimensions
    || vector.some(value => !Number.isFinite(value))
    || !vector.some(value => value !== 0)
  ) {
    throw new Error('Vector retrieval query embedding is invalid')
  }
}

async function runOwnedReadQuery<Row>(
  pool: ArticleRetrievalPool,
  text: string,
  values: unknown[],
  context: DatabaseArticleRetrievalExecutionContext,
  onSqlLatencyMs?: (latencyMs: number) => void,
): Promise<Row[]> {
  const operation = createDatabaseOperationSignal(context)
  let client: ArticleRetrievalPoolClient | undefined
  let released = false
  let termination: Promise<void> | undefined
  const release = (error?: Error): void => {
    if (released || !client)
      return
    released = true
    client.release(error)
  }
  const terminate = (error: Error): Promise<void> => {
    if (termination)
      return termination

    termination = (async () => {
      try {
        if (client?.processID !== undefined)
          await pool.cancel(client.processID)
      }
      catch (cause) {
        if (!('cause' in error)) {
          Object.defineProperty(error, 'cause', {
            configurable: true,
            value: cause,
          })
        }
      }
      finally {
        release(error)
      }
    })()
    return termination
  }

  try {
    client = await connectWithAbort(pool, operation.signal)
    await queryWithAbort(client, 'BEGIN READ ONLY', [], operation.signal, terminate)

    const remainingBudgetMs = remainingTimeoutMs(context.databaseDeadline)
    const statementTimeoutMs = Math.max(
      1,
      remainingBudgetMs - PG_STATEMENT_TIMEOUT_LEAD_MS,
    )
    const lockTimeoutMs = Math.max(
      1,
      statementTimeoutMs - PG_LOCK_TIMEOUT_LEAD_MS,
    )
    await queryWithAbort(
      client,
      SET_LOCAL_TIMEOUTS_SQL,
      [`${statementTimeoutMs}ms`, `${lockTimeoutMs}ms`],
      operation.signal,
      terminate,
    )
    const sqlStartedAt = performance.now()
    const result = await queryWithAbort<Row>(
      client,
      text,
      values,
      operation.signal,
      terminate,
    )
    onSqlLatencyMs?.(performance.now() - sqlStartedAt)
    await queryWithAbort(client, 'COMMIT', [], operation.signal, terminate)
    release()
    return result.rows
  }
  catch (error) {
    if (operation.signal.aborted) {
      if (termination)
        await termination
      const abortError = abortReason(operation.signal)
      release(abortError)
      throw abortError
    }
    const mappedError = isPostgresTimeout(error)
      ? createTimeoutError(context.databaseDeadline, error)
      : error
    const releaseError = toError(mappedError, 'Article retrieval query failed')
    release(releaseError)
    throw mappedError
  }
  finally {
    operation.cleanup()
  }
}

function createDatabaseOperationSignal(
  context: DatabaseArticleRetrievalExecutionContext,
): { signal: AbortSignal, cleanup: () => void } {
  context.signal.throwIfAborted()
  context.databaseDeadline.signal?.throwIfAborted()
  const timeoutMs = remainingTimeoutMs(context.databaseDeadline)
  const timeoutController = new AbortController()
  const signals = [context.signal, timeoutController.signal]
  if (
    context.databaseDeadline.signal
    && context.databaseDeadline.signal !== context.signal
  ) {
    signals.push(context.databaseDeadline.signal)
  }

  const timer = setTimeout(
    () => timeoutController.abort(context.databaseDeadline.createTimeoutError()),
    timeoutMs,
  )
  timer.unref?.()

  return {
    signal: AbortSignal.any(signals),
    cleanup: () => clearTimeout(timer),
  }
}

function remainingTimeoutMs(deadline: DatabaseOperationDeadline): number {
  deadline.signal?.throwIfAborted()
  const remaining = Math.floor(deadline.deadlineAt - Date.now())
  if (remaining <= 0)
    throw deadline.createTimeoutError()
  return remaining
}

async function connectWithAbort(
  pool: ArticleRetrievalPool,
  signal: AbortSignal,
): Promise<ArticleRetrievalPoolClient> {
  signal.throwIfAborted()
  const connection = pool.connect()

  return await new Promise<ArticleRetrievalPoolClient>((resolve, reject) => {
    // client 所有权只由下面这一条 connection reaction 仲裁，不允许出现第二条 release 路径：
    // abortError 为空表示所有权移交调用方，由 runOwnedReadQuery 负责最终 release；
    // abortError 已存在表示 Abort 先决定了结果，迟到的 client 仍归本函数，在这里 release 恰好一次。
    let abortError: Error | undefined
    const handleAbort = (): void => {
      abortError = abortReason(signal)
      reject(abortError)
    }
    signal.addEventListener('abort', handleAbort, { once: true })

    void connection.then(
      (client) => {
        // reaction 一旦执行，Abort 就不可能再改变所有权归属。
        signal.removeEventListener('abort', handleAbort)
        if (abortError) {
          client.release(abortError)
          return
        }
        resolve(client)
      },
      (error) => {
        signal.removeEventListener('abort', handleAbort)
        // Abort 已经是最终结果时，这里只负责安全观察迟到的连接失败。
        if (abortError)
          return
        reject(error)
      },
    )
  })
}

async function queryWithAbort<Row>(
  client: ArticleRetrievalPoolClient,
  text: string,
  values: unknown[],
  signal: AbortSignal,
  terminateOnAbort: (error: Error) => Promise<void>,
): Promise<PgQueryResult<Row>> {
  signal.throwIfAborted()
  let handleAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    handleAbort = () => {
      const error = abortReason(signal)
      void terminateOnAbort(error).then(
        () => reject(error),
        () => reject(error),
      )
    }
    signal.addEventListener('abort', handleAbort, { once: true })
  })

  try {
    return await Promise.race([
      client.query<Row>(text, values),
      aborted,
    ])
  }
  finally {
    if (handleAbort)
      signal.removeEventListener('abort', handleAbort)
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Article retrieval aborted', 'AbortError')
}

function isPostgresTimeout(error: unknown): boolean {
  const candidate = error as { code?: unknown, message?: unknown }
  return (
    candidate.code === '57014'
    && typeof candidate.message === 'string'
    && candidate.message.includes('statement timeout')
  ) || (
    candidate.code === '55P03'
    && typeof candidate.message === 'string'
    && candidate.message.includes('lock timeout')
  )
}

function createTimeoutError(
  deadline: DatabaseOperationDeadline,
  cause: unknown,
): Error {
  const error = deadline.createTimeoutError()
  if (!('cause' in error)) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      value: cause,
    })
  }
  return error
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
}
