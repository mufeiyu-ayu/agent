import type { PrismaService } from '../prisma/prisma.service.js'
import type {
  ArticleSourceSnapshot,
  CanonicalArticleSource,
  DeterministicArticleChunk,
} from './article-chunking.js'
import { createRequire } from 'node:module'

import { ACTIVE_EMBEDDING_PROFILE } from '../embeddings/embedding-provider.js'
import { Prisma } from '../generated/prisma/client.js'
import { DatabaseOperationDeadlineExceededError } from '../prisma/prisma.service.js'
import {
  ARTICLE_CHUNKER_PROFILE,
  canonicalizeArticleSource,
} from './article-chunking.js'

// Stable repository-wide lock key for the Article indexing command.
const ARTICLE_INDEX_ADVISORY_LOCK_KEY = '4705214427600998897'
const ARTICLE_INDEX_DATABASE_OPERATION_TIMEOUT_MS = 60_000
const require = createRequire(import.meta.url)
const { Pool: PgPool } = require('pg') as {
  Pool: new (options: {
    connectionString: string
    max: number
    connectionTimeoutMillis: number
    query_timeout: number
    statement_timeout: number
  }) => ArticleIndexPool
}

export interface ArticleIndexPool {
  connect: () => Promise<ArticleIndexPoolClient>
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<PgQueryResult<Row>>
  end: () => Promise<void>
}

interface ArticleIndexPoolClient {
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<PgQueryResult<Row>>
  release: (error?: Error) => void
}

interface PgQueryResult<Row> {
  rows: Row[]
}

const articleSnapshotSelect = {
  id: true,
  sourceId: true,
  title: true,
  languageCode: true,
  content: true,
  updatedAt: true,
} as const

export interface ArticleIndexStatus {
  sourceHash: string
  sourceUpdatedAt: Date
  currentSourceUpdatedAt: Date
  chunkerVersion: string
  embeddingVersion: string
  declaredChunkCount: number
  actualChunkCount: number
}

export interface ArticleIndexCommandLock {
  release: () => Promise<void>
}

export interface ArticleIndexRepositoryContract {
  acquireCommandLock: (
    signal: AbortSignal,
  ) => Promise<ArticleIndexCommandLock | null>
  assertSchemaReady: (signal: AbortSignal) => Promise<void>
  findArticleBySourceId: (
    sourceId: number,
    signal: AbortSignal,
  ) => Promise<ArticleSourceSnapshot | null>
  listArticlesAfter: (
    afterSourceId: number | undefined,
    take: number,
    signal: AbortSignal,
  ) => Promise<ArticleSourceSnapshot[]>
  getIndexStatus: (
    source: CanonicalArticleSource,
    signal: AbortSignal,
  ) => Promise<ArticleIndexStatus | null>
  refreshIndexSourceUpdatedAt: (
    source: CanonicalArticleSource,
    signal: AbortSignal,
  ) => Promise<boolean>
  replaceArticleIndex: (input: ArticleIndexReplacement) => Promise<'committed' | 'stale'>
}

export interface ArticleIndexReplacement {
  source: CanonicalArticleSource
  chunks: readonly DeterministicArticleChunk[]
  vectors: readonly number[][]
  embeddingProfile: typeof ACTIVE_EMBEDDING_PROFILE
  signal: AbortSignal
}

export class ArticleIndexSchemaError extends Error {
  constructor(message = 'Article embedding index schema 或 pgvector extension 未就绪') {
    super(message)
    this.name = 'ArticleIndexSchemaError'
  }
}

export class ArticleIndexRepository implements ArticleIndexRepositoryContract {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: ArticleIndexPool,
  ) {}

  async acquireCommandLock(
    signal: AbortSignal,
  ): Promise<ArticleIndexCommandLock | null> {
    signal.throwIfAborted()
    const client = await this.pool.connect()
    let released = false
    const release = (error?: Error): void => {
      if (released)
        return
      released = true
      client.release(error)
    }

    try {
      const result = await queryClientWithAbort<{ acquired: boolean }>(
        client,
        'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
        [ARTICLE_INDEX_ADVISORY_LOCK_KEY],
        signal,
        release,
      )
      signal.throwIfAborted()

      if (result.rows[0]?.acquired !== true) {
        release()
        return null
      }

      return createCommandLock(client)
    }
    catch (error) {
      release(error instanceof Error ? error : new Error('lock query failed'))
      throw error
    }
  }

  async assertSchemaReady(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const client = await this.pool.connect()
    let released = false
    const release = (error?: Error): void => {
      if (released)
        return
      released = true
      client.release(error)
    }

    let result: PgQueryResult<{
      vector_extension: boolean
      chunk_table: boolean
      state_table: boolean
      embedding_type: string | null
    }>

    try {
      result = await queryClientWithAbort(client, `
        SELECT
          EXISTS (
            SELECT 1 FROM pg_extension WHERE extname = 'vector'
          ) AS vector_extension,
          to_regclass('"ArticleChunk"') IS NOT NULL AS chunk_table,
          to_regclass('"ArticleIndexState"') IS NOT NULL AS state_table,
          (
            SELECT format_type(attribute.atttypid, attribute.atttypmod)
            FROM pg_attribute AS attribute
            JOIN pg_class AS relation ON relation.oid = attribute.attrelid
            WHERE relation.oid = to_regclass('"ArticleChunk"')
              AND attribute.attname = 'embedding'
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
            LIMIT 1
          ) AS embedding_type
      `, [], signal, release)
      signal.throwIfAborted()
      release()
    }
    catch (error) {
      release(error instanceof Error ? error : new Error('schema query failed'))
      throw error
    }
    const status = result.rows[0]

    if (
      status?.vector_extension !== true
      || status.chunk_table !== true
      || status.state_table !== true
      || status.embedding_type !== 'vector(1536)'
    ) {
      throw new ArticleIndexSchemaError()
    }
  }

  async findArticleBySourceId(
    sourceId: number,
    signal: AbortSignal,
  ): Promise<ArticleSourceSnapshot | null> {
    return await this.prisma.withDeadlineTransaction(
      createDatabaseDeadline(signal),
      async transaction => await transaction.execute(prisma => (
        prisma.article.findUnique({
          where: { sourceId },
          select: articleSnapshotSelect,
        })
      )),
    )
  }

  async listArticlesAfter(
    afterSourceId: number | undefined,
    take: number,
    signal: AbortSignal,
  ): Promise<ArticleSourceSnapshot[]> {
    return await this.prisma.withDeadlineTransaction(
      createDatabaseDeadline(signal),
      async transaction => await transaction.execute(prisma => (
        prisma.article.findMany({
          ...(afterSourceId === undefined
            ? {}
            : { where: { sourceId: { gt: afterSourceId } } }),
          select: articleSnapshotSelect,
          orderBy: { sourceId: 'asc' },
          take,
        })
      )),
    )
  }

  async getIndexStatus(
    source: CanonicalArticleSource,
    signal: AbortSignal,
  ): Promise<ArticleIndexStatus | null> {
    return await this.prisma.withDeadlineTransaction(
      createDatabaseDeadline(signal),
      async (transaction) => {
        const rows = await transaction.execute(prisma => (
          prisma.$queryRaw<LockedArticleRow[]>(Prisma.sql`
            SELECT
              "id",
              "sourceId",
              "title",
              "languageCode",
              "content",
              "updatedAt"
            FROM "Article"
            WHERE "id" = ${source.articleId}
            FOR SHARE
          `)
        ))
        signal.throwIfAborted()
        const row = rows[0]
        if (!row)
          return null

        let currentSource: CanonicalArticleSource
        try {
          currentSource = canonicalizeArticleSource({
            id: row.id,
            sourceId: row.sourceId,
            title: row.title,
            languageCode: row.languageCode,
            content: row.content,
            updatedAt: row.updatedAt,
          })
        }
        catch {
          return null
        }
        if (currentSource.sourceHash !== source.sourceHash)
          return null

        const state = await transaction.execute(prisma => (
          prisma.articleIndexState.findUnique({
            where: { articleId: source.articleId },
            select: {
              sourceHash: true,
              sourceUpdatedAt: true,
              chunkerVersion: true,
              embeddingVersion: true,
              chunkCount: true,
            },
          })
        ))
        const actualChunkCount = await transaction.execute(prisma => (
          prisma.articleChunk.count({ where: { articleId: source.articleId } })
        ))

        if (!state)
          return null

        return {
          sourceHash: state.sourceHash,
          sourceUpdatedAt: state.sourceUpdatedAt,
          currentSourceUpdatedAt: currentSource.sourceUpdatedAt,
          chunkerVersion: state.chunkerVersion,
          embeddingVersion: state.embeddingVersion,
          declaredChunkCount: state.chunkCount,
          actualChunkCount,
        }
      },
    )
  }

  async refreshIndexSourceUpdatedAt(
    source: CanonicalArticleSource,
    signal: AbortSignal,
  ): Promise<boolean> {
    return await this.prisma.withDeadlineTransaction(
      createDatabaseDeadline(signal),
      async (transaction) => {
        const rows = await transaction.execute(prisma => (
          prisma.$queryRaw<LockedArticleRow[]>(Prisma.sql`
            SELECT
              "id",
              "sourceId",
              "title",
              "languageCode",
              "content",
              "updatedAt"
            FROM "Article"
            WHERE "id" = ${source.articleId}
            FOR UPDATE
          `)
        ))
        signal.throwIfAborted()
        const row = rows[0]
        if (!row)
          return false

        const currentSource = canonicalizeArticleSource({
          id: row.id,
          sourceId: row.sourceId,
          title: row.title,
          languageCode: row.languageCode,
          content: row.content,
          updatedAt: row.updatedAt,
        })
        if (currentSource.sourceHash !== source.sourceHash)
          return false

        const result = await transaction.execute(prisma => (
          prisma.$queryRaw<Array<{ refreshed: boolean }>>(Prisma.sql`
            UPDATE "ArticleIndexState" AS state
            SET
              "sourceUpdatedAt" = ${row.updatedAt},
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE state."articleId" = ${source.articleId}
              AND state."sourceHash" = ${source.sourceHash}
              AND state."chunkerVersion" = ${ARTICLE_CHUNKER_PROFILE.version}
              AND state."embeddingVersion" = ${ACTIVE_EMBEDDING_PROFILE.version}
              AND state."chunkCount" = (
                SELECT COUNT(*)::integer
                FROM "ArticleChunk" AS chunk
                WHERE chunk."articleId" = state."articleId"
              )
            RETURNING true AS refreshed
          `)
        ))
        signal.throwIfAborted()
        return result[0]?.refreshed === true
      },
    )
  }

  async replaceArticleIndex(
    input: ArticleIndexReplacement,
  ): Promise<'committed' | 'stale'> {
    validateReplacement(input)
    input.signal.throwIfAborted()

    return await this.prisma.withDeadlineTransaction(
      createDatabaseDeadline(input.signal),
      async (transaction) => {
        const rows = await transaction.execute(prisma => (
          prisma.$queryRaw<LockedArticleRow[]>(Prisma.sql`
            SELECT
              "id",
              "sourceId",
              "title",
              "languageCode",
              "content",
              "updatedAt"
            FROM "Article"
            WHERE "id" = ${input.source.articleId}
            FOR UPDATE
          `)
        ))
        input.signal.throwIfAborted()
        const row = rows[0]

        if (!row)
          return 'stale'

        const currentSource = canonicalizeArticleSource({
          id: row.id,
          sourceId: row.sourceId,
          title: row.title,
          languageCode: row.languageCode,
          content: row.content,
          updatedAt: row.updatedAt,
        })

        if (currentSource.sourceHash !== input.source.sourceHash)
          return 'stale'

        input.signal.throwIfAborted()
        await transaction.execute(prisma => prisma.articleChunk.deleteMany({
          where: { articleId: input.source.articleId },
        }))
        input.signal.throwIfAborted()

        const now = new Date()
        for (const [index, chunk] of input.chunks.entries()) {
          const vectorLiteral = `[${input.vectors[index]!.join(',')}]`
          await transaction.execute(prisma => prisma.$executeRaw(Prisma.sql`
            INSERT INTO "ArticleChunk" (
              "id",
              "articleId",
              "ordinal",
              "languageCode",
              "sectionPath",
              "content",
              "tokenCount",
              "contentHash",
              "embeddingInputHash",
              "chunkerVersion",
              "embeddingProvider",
              "embeddingModel",
              "embeddingDimensions",
              "embeddingVersion",
              "embedding",
              "createdAt",
              "updatedAt"
            ) VALUES (
              ${chunk.id},
              ${chunk.articleId},
              ${chunk.ordinal},
              ${chunk.languageCode},
              ${chunk.sectionPath},
              ${chunk.content},
              ${chunk.tokenCount},
              ${chunk.contentHash},
              ${chunk.embeddingInputHash},
              ${chunk.chunkerVersion},
              ${input.embeddingProfile.provider},
              ${input.embeddingProfile.model},
              ${input.embeddingProfile.dimensions},
              ${chunk.embeddingVersion},
              ${vectorLiteral}::vector,
              ${now},
              ${now}
            )
          `))
          input.signal.throwIfAborted()
        }

        input.signal.throwIfAborted()
        await transaction.execute(prisma => prisma.articleIndexState.upsert({
          where: { articleId: input.source.articleId },
          create: {
            articleId: input.source.articleId,
            sourceHash: currentSource.sourceHash,
            sourceUpdatedAt: row.updatedAt,
            chunkerVersion: input.chunks[0]?.chunkerVersion
              ?? ARTICLE_CHUNKER_PROFILE.version,
            embeddingVersion: input.embeddingProfile.version,
            chunkCount: input.chunks.length,
            indexedAt: now,
          },
          update: {
            sourceHash: currentSource.sourceHash,
            sourceUpdatedAt: row.updatedAt,
            chunkerVersion: input.chunks[0]?.chunkerVersion
              ?? ARTICLE_CHUNKER_PROFILE.version,
            embeddingVersion: input.embeddingProfile.version,
            chunkCount: input.chunks.length,
            indexedAt: now,
          },
        }))
        input.signal.throwIfAborted()

        return 'committed'
      },
      () => {},
    )
  }
}

export function createArticleIndexPool(connectionString: string): ArticleIndexPool {
  return new PgPool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 2_000,
    query_timeout: ARTICLE_INDEX_DATABASE_OPERATION_TIMEOUT_MS,
    statement_timeout: ARTICLE_INDEX_DATABASE_OPERATION_TIMEOUT_MS,
  })
}

interface LockedArticleRow {
  id: string
  sourceId: number
  title: string
  languageCode: string
  content: string
  updatedAt: Date
}

function validateReplacement(input: ArticleIndexReplacement): void {
  if (input.chunks.length !== input.vectors.length)
    throw new Error('Article index chunk/vector count mismatch')

  for (const [index, chunk] of input.chunks.entries()) {
    const vector = input.vectors[index]
    if (
      chunk.articleId !== input.source.articleId
      || chunk.ordinal !== index
      || chunk.embeddingVersion !== input.embeddingProfile.version
      || !vector
      || vector.length !== input.embeddingProfile.dimensions
      || vector.some(value => !Number.isFinite(value))
    ) {
      throw new Error('Article index replacement is invalid')
    }
  }
}

function createDatabaseDeadline(signal: AbortSignal) {
  return {
    deadlineAt: Date.now() + ARTICLE_INDEX_DATABASE_OPERATION_TIMEOUT_MS,
    signal,
    createTimeoutError: () => new DatabaseOperationDeadlineExceededError(
      'Article indexing 数据库操作超时',
    ),
  }
}

async function queryClientWithAbort<Row>(
  client: ArticleIndexPoolClient,
  text: string,
  values: unknown[],
  signal: AbortSignal,
  releaseOnAbort: (error: Error) => void,
): Promise<PgQueryResult<Row>> {
  signal.throwIfAborted()
  let handleAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    handleAbort = () => {
      const error = signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Article indexing aborted', 'AbortError')
      releaseOnAbort(error)
      reject(error)
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

function createCommandLock(client: ArticleIndexPoolClient): ArticleIndexCommandLock {
  let released = false

  return {
    release: async () => {
      if (released)
        return
      released = true
      try {
        await client.query(
          'SELECT pg_advisory_unlock($1::bigint)',
          [ARTICLE_INDEX_ADVISORY_LOCK_KEY],
        )
      }
      catch (error) {
        client.release(error instanceof Error ? error : new Error('unlock failed'))
        throw error
      }
      client.release()
    },
  }
}
