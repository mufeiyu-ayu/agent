import type { EmbeddingProvider } from '../../embeddings/embedding-provider.js'
import type {
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from '../article-retrieval.js'
import type { ArticleRetrievalRepositoryContract } from '../persistence/postgres-article-retrieval.repository.js'
import type {
  RetrievalQualityV2Report,
  RetrievalQualityV2Strategies,
  RetrievalQualityV2StrategyRunner,
} from './article-retrieval-quality-v2.js'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { resolveEmbeddingRuntimeConfig } from '../../embeddings/embedding-provider.js'
import { GeminiEmbeddingProvider } from '../../embeddings/gemini-embedding.provider.js'
import {
  DatabaseOperationDeadlineExceededError,
} from '../../prisma/prisma.service.js'
import {
  createArticleRetrievalPool,
  PostgresArticleRetrievalRepository,
} from '../persistence/postgres-article-retrieval.repository.js'
import { HybridArticleRetriever } from '../retrievers/hybrid-article-retriever.js'
import { LexicalArticleRetriever } from '../retrievers/lexical-article-retriever.js'
import { VectorArticleRetriever } from '../retrievers/vector-article-retriever.js'
import { evaluateArticleRetrievalQualityV2 } from './article-retrieval-quality-v2.js'

const QUALITY_DATABASE_TIMEOUT_MS = 60_000

export async function runArticleRetrievalQualityV2Cli(options: {
  strategies: RetrievalQualityV2Strategies
  now?: () => number
  signal?: AbortSignal
  stdout?: { write: (text: string) => unknown }
}): Promise<RetrievalQualityV2Report> {
  const report = await evaluateArticleRetrievalQualityV2(options)

  ;(options.stdout ?? process.stdout).write(`${JSON.stringify(report, null, 2)}\n`)

  return report
}

interface RetrievalQualityRuntime {
  strategies: RetrievalQualityV2Strategies
  close: () => Promise<void>
}

function createMeasuredRunner(
  provider: EmbeddingProvider,
  repository: ArticleRetrievalRepositoryContract,
  createRetriever: (
    measuredProvider: EmbeddingProvider,
    measuredRepository: ArticleRetrievalRepositoryContract,
  ) => ArticleRetriever<DatabaseArticleRetrievalExecutionContext>,
): RetrievalQualityV2StrategyRunner {
  return {
    run: async (query, { signal }) => {
      let embeddingLatencyMs: number | null = null
      let providerRequests = 0
      let retryCount = 0
      let vectorSqlLatencyMs: number | null = null
      const measuredProvider: EmbeddingProvider = {
        profile: provider.profile,
        embed: async (inputs, options) => {
          const startedAt = performance.now()
          try {
            const result = await provider.embed(inputs, options)
            providerRequests += result.providerRequests
            retryCount += result.retryCount
            return result
          }
          finally {
            embeddingLatencyMs = performance.now() - startedAt
          }
        },
      }
      const measuredRepository: ArticleRetrievalRepositoryContract = {
        findLexicalCandidates: async (input, context) => (
          await repository.findLexicalCandidates(input, context)
        ),
        findVectorChunkCandidates: async (
          vector,
          input,
          context,
          onSqlLatencyMs,
        ) => await repository.findVectorChunkCandidates(
          vector,
          input,
          context,
          (latencyMs) => {
            vectorSqlLatencyMs = latencyMs
            onSqlLatencyMs?.(latencyMs)
          },
        ),
      }
      const result = await createRetriever(
        measuredProvider,
        measuredRepository,
      ).retrieve(query, createDatabaseContext(signal))

      return {
        result,
        embedding: {
          latencyMs: embeddingLatencyMs,
          providerRequests,
          retryCount,
        },
        vectorSqlLatencyMs,
      }
    },
  }
}

async function createProductionRuntime(): Promise<RetrievalQualityRuntime> {
  const connectionString = process.env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error(
      'ARTICLE_INDEX_TEST_DATABASE_URL 未配置，quality-v2 只允许使用隔离数据库',
    )
  }

  const provider = new GeminiEmbeddingProvider(
    resolveEmbeddingRuntimeConfig(process.env),
  )
  const pool = createArticleRetrievalPool(connectionString)
  const repository = new PostgresArticleRetrievalRepository(pool)
  // standalone lexical 基线必须与 hybrid 内部 lexical 通道同一实现
  // （postgres_lexical_ranked@1）：对照实验的基线与对照组组件不同源时，
  // hybrid 的增益无法归因（旧报告用 prisma_lexical@1，口径不可直接对比）。
  const lexicalRetriever = new LexicalArticleRetriever(repository)

  return {
    strategies: {
      lexical: {
        run: async (query, { signal }) => ({
          result: await lexicalRetriever.retrieve(
            query,
            createDatabaseContext(signal),
          ),
          embedding: {
            latencyMs: null,
            providerRequests: 0,
            retryCount: 0,
          },
          vectorSqlLatencyMs: null,
        }),
      },
      vector: createMeasuredRunner(
        provider,
        repository,
        (measuredProvider, measuredRepository) => (
          new VectorArticleRetriever(measuredProvider, measuredRepository)
        ),
      ),
      hybrid: createMeasuredRunner(
        provider,
        repository,
        (measuredProvider, measuredRepository) => new HybridArticleRetriever(
          new LexicalArticleRetriever(measuredRepository),
          new VectorArticleRetriever(measuredProvider, measuredRepository),
        ),
      ),
    },
    close: async () => {
      await pool.end()
    },
  }
}

function createDatabaseContext(
  signal: AbortSignal,
): DatabaseArticleRetrievalExecutionContext {
  return {
    signal,
    databaseDeadline: {
      deadlineAt: Date.now() + QUALITY_DATABASE_TIMEOUT_MS,
      signal,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(
        'Article retrieval quality-v2 数据库操作超时',
      ),
    },
  }
}

async function main(): Promise<void> {
  const abortController = new AbortController()
  const abort = (): void => abortController.abort(
    new DOMException('retrieval quality-v2 aborted', 'AbortError'),
  )
  let runtime: RetrievalQualityRuntime | undefined
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)

  try {
    runtime = await createProductionRuntime()
    await runArticleRetrievalQualityV2Cli({
      strategies: runtime.strategies,
      signal: abortController.signal,
    })
  }
  catch {
    process.stderr.write(`${JSON.stringify({
      error: abortController.signal.aborted
        ? 'retrieval_quality_aborted'
        : 'retrieval_quality_failed',
      message: 'article-retrieval-quality-v2 执行失败',
    })}\n`)
    process.exitCode = 1
  }
  finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
    await runtime?.close().catch(() => {
      process.exitCode = 1
    })
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
  void main()
