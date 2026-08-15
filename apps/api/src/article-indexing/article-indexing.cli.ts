import type {
  ArticleIndexMode,
  ArticleIndexSummary,
} from './article-indexer.js'
import process from 'node:process'

import { pathToFileURL } from 'node:url'
import {
  EmbeddingError,
  resolveEmbeddingRuntimeConfig,
} from '../embeddings/embedding-provider.js'
import { GeminiEmbeddingProvider } from '../embeddings/gemini-embedding.provider.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  ArticleIndexRepository,
  createArticleIndexPool,
} from './article-index.repository.js'
import {
  ArticleIndexer,
  createArticleIndexSummary,
  isArticleIndexSummarySuccessful,
} from './article-indexer.js'

interface ParsedArticleIndexCliArgs {
  mode: ArticleIndexMode
  sourceId?: number
  databaseScope: ArticleIndexDatabaseScope
}

type ArticleIndexDatabaseScope = 'normal' | 'integration'

interface ArticleIndexDatabaseEnvironment {
  readonly DATABASE_URL?: string
  readonly ARTICLE_INDEX_TEST_DATABASE_URL?: string
}

interface ArticleIndexCliRuntime {
  indexer: ArticleIndexer
  close: () => Promise<void>
}

type RuntimeFactory = (
  databaseScope: ArticleIndexDatabaseScope,
) => Promise<ArticleIndexCliRuntime>

export function parseArticleIndexCliArgs(
  args: readonly string[],
): ParsedArticleIndexCliArgs {
  let mode: ArticleIndexMode | undefined
  let sourceId: number | undefined
  let databaseScope: ArticleIndexDatabaseScope = 'normal'
  let databaseScopeProvided = false
  const separatorCount = args.filter(argument => argument === '--').length
  if (separatorCount > 1)
    throw cliArgumentError('存在不支持参数')
  const normalizedArgs = args.filter(argument => argument !== '--')

  for (const argument of normalizedArgs) {
    if (argument.startsWith('--mode=')) {
      if (mode !== undefined)
        throw cliArgumentError('--mode 不得重复')
      const value = argument.slice('--mode='.length)
      if (value !== 'incremental' && value !== 'full')
        throw cliArgumentError('--mode 只接受 incremental 或 full')
      mode = value
      continue
    }

    if (argument.startsWith('--source-id=')) {
      if (sourceId !== undefined)
        throw cliArgumentError('--source-id 不得重复')
      const value = argument.slice('--source-id='.length)
      if (!/^[1-9]\d*$/.test(value))
        throw cliArgumentError('--source-id 必须是正安全整数')
      sourceId = Number(value)
      if (!Number.isSafeInteger(sourceId))
        throw cliArgumentError('--source-id 必须是正安全整数')
      continue
    }

    if (argument.startsWith('--database-scope=')) {
      if (databaseScopeProvided)
        throw cliArgumentError('--database-scope 不得重复')
      const value = argument.slice('--database-scope='.length)
      if (value !== 'integration')
        throw cliArgumentError('--database-scope 只接受 integration')
      databaseScope = value
      databaseScopeProvided = true
      continue
    }

    throw cliArgumentError('存在不支持参数')
  }

  if (mode === undefined)
    throw cliArgumentError('--mode 必填')

  return {
    mode,
    ...(sourceId === undefined ? {} : { sourceId }),
    databaseScope,
  }
}

export async function executeArticleIndexCli(
  args: readonly string[],
  signal: AbortSignal,
  createRuntime: RuntimeFactory = createProductionRuntime,
): Promise<ArticleIndexSummary> {
  // Parsing is deliberately first: invalid arguments cannot acquire a DB
  // connection or construct the provider adapter.
  const { databaseScope, ...options } = parseArticleIndexCliArgs(args)
  let summary = createArticleIndexSummary(options)
  let runtime: ArticleIndexCliRuntime | undefined

  try {
    signal.throwIfAborted()
    runtime = await createRuntime(databaseScope)
    summary = await runtime.indexer.run({ ...options, signal })
  }
  catch (error) {
    if (isAbortError(error) || signal.aborted) {
      summary.aborted = true
    }
    else {
      summary.fatal = safeCliFatal(error)
    }
  }
  finally {
    if (runtime) {
      try {
        await runtime.close()
      }
      catch {
        summary.fatal ??= {
          code: 'database',
          message: '关闭 Article indexing 数据库连接失败',
        }
      }
    }
  }

  return summary
}

export function serializeArticleIndexSummary(
  summary: ArticleIndexSummary,
): string {
  return JSON.stringify(summary, null, 2)
}

async function createProductionRuntime(
  databaseScope: ArticleIndexDatabaseScope,
): Promise<ArticleIndexCliRuntime> {
  const connectionString = resolveArticleIndexDatabaseUrl(
    databaseScope,
    process.env,
  )
  const embeddingConfig = resolveEmbeddingRuntimeConfig(process.env)

  const prisma = new PrismaService(connectionString)
  const pool = createArticleIndexPool(connectionString)

  try {
    await prisma.$connect()
  }
  catch (error) {
    await pool.end().catch(() => {})
    await prisma.$disconnect().catch(() => {})
    throw error
  }

  const repository = new ArticleIndexRepository(prisma, pool)
  const provider = new GeminiEmbeddingProvider(embeddingConfig)

  return {
    indexer: new ArticleIndexer(repository, provider),
    close: async () => {
      await Promise.all([
        pool.end(),
        prisma.$disconnect(),
      ])
    },
  }
}

export function resolveArticleIndexDatabaseUrl(
  databaseScope: ArticleIndexDatabaseScope,
  env: ArticleIndexDatabaseEnvironment,
): string {
  if (databaseScope === 'normal') {
    const connectionString = env.DATABASE_URL?.trim()
    if (!connectionString)
      throw new ArticleIndexCliConfigurationError('DATABASE_URL 未配置')
    return connectionString
  }

  const connectionString = env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()
  if (!connectionString) {
    throw new ArticleIndexCliConfigurationError(
      'ARTICLE_INDEX_TEST_DATABASE_URL 未配置',
    )
  }
  if (connectionString === env.DATABASE_URL?.trim()) {
    throw new ArticleIndexCliConfigurationError(
      'ARTICLE_INDEX_TEST_DATABASE_URL 不得与 DATABASE_URL 相同',
    )
  }
  return connectionString
}

class ArticleIndexCliConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArticleIndexCliConfigurationError'
  }
}

function cliArgumentError(message: string): Error {
  return new Error(`invalid article indexing arguments: ${message}`)
}

function safeCliFatal(error: unknown): NonNullable<ArticleIndexSummary['fatal']> {
  if (error instanceof EmbeddingError) {
    return {
      code: `embedding_${error.code}`,
      message: error.message,
    }
  }
  if (error instanceof ArticleIndexCliConfigurationError) {
    return {
      code: 'configuration',
      message: error.message,
    }
  }
  return {
    code: 'database',
    message: '初始化 Article indexing 数据库连接失败',
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

async function main(): Promise<void> {
  const abortController = new AbortController()
  const handleSignal = (signal: 'SIGINT' | 'SIGTERM'): void => {
    abortController.abort(new DOMException(
      `Article indexing received ${signal}`,
      'AbortError',
    ))
  }
  const handleSigint = (): void => handleSignal('SIGINT')
  const handleSigterm = (): void => handleSignal('SIGTERM')
  process.once('SIGINT', handleSigint)
  process.once('SIGTERM', handleSigterm)

  try {
    const summary = await executeArticleIndexCli(
      process.argv.slice(2),
      abortController.signal,
    )
    process.stdout.write(`${serializeArticleIndexSummary(summary)}\n`)
    process.exitCode = isArticleIndexSummarySuccessful(summary) ? 0 : 1
  }
  catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: error instanceof Error ? error.message : 'invalid arguments',
    })}\n`)
    process.exitCode = 1
  }
  finally {
    process.removeListener('SIGINT', handleSigint)
    process.removeListener('SIGTERM', handleSigterm)
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
  void main()
