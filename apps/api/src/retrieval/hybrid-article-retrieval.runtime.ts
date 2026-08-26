import type { OnModuleDestroy } from '@nestjs/common'
import type {
  ArticleRetrievalInput,
  ArticleRetrievalResult,
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from './article-retrieval.js'
import process from 'node:process'
import { Injectable } from '@nestjs/common'

import { resolveEmbeddingRuntimeConfig } from '../embeddings/embedding-provider.js'
import { GeminiEmbeddingProvider } from '../embeddings/gemini-embedding.provider.js'
import {
  createArticleRetrievalPool,
  PostgresArticleRetrievalRepository,
} from './persistence/postgres-article-retrieval.repository.js'
import { HybridArticleRetriever } from './retrievers/hybrid-article-retriever.js'
import { LexicalArticleRetriever } from './retrievers/lexical-article-retriever.js'
import { VectorArticleRetriever } from './retrievers/vector-article-retriever.js'

export interface HybridArticleRetrievalRuntimeHandle {
  retriever: ArticleRetriever<DatabaseArticleRetrievalExecutionContext>
  close: () => Promise<void>
}

/**
 * 组装 Task 2A 的正式 `hybrid_rrf@1` 检索链路：
 * Gemini query embedding + PostgreSQL lexical / pgvector exact search + RRF 融合。
 *
 * 这里只做组装，不复制 SQL、ranking 或 RRF；调用方负责关闭返回的连接池。
 */
export function createHybridArticleRetrievalRuntime(
  env: NodeJS.ProcessEnv,
): HybridArticleRetrievalRuntimeHandle {
  const connectionString = env.DATABASE_URL?.trim()

  if (!connectionString)
    throw new Error('请在项目根目录 .env 中设置 DATABASE_URL')

  // Embedding 配置在这里才解析；普通 API 启动不会走到本函数。
  const embeddingProvider = new GeminiEmbeddingProvider(
    resolveEmbeddingRuntimeConfig(env),
  )
  const pool = createArticleRetrievalPool(connectionString)
  const repository = new PostgresArticleRetrievalRepository(pool)

  return {
    retriever: new HybridArticleRetriever(
      new LexicalArticleRetriever(repository),
      new VectorArticleRetriever(embeddingProvider, repository),
    ),
    close: async () => await pool.end(),
  }
}

/**
 * Retrieval Tool 在 NestJS 中的按需初始化边界。
 *
 * 首次真实调用前不解析 `GEMINI_API_KEY`、不创建数据库连接池，因此没有配置
 * Embedding 的环境仍可以正常启动 API、构建和运行无关测试。
 */
@Injectable()
export class HybridArticleRetrievalRuntime
implements ArticleRetriever<DatabaseArticleRetrievalExecutionContext>, OnModuleDestroy {
  private handle: HybridArticleRetrievalRuntimeHandle | undefined

  async retrieve(
    input: ArticleRetrievalInput,
    context: DatabaseArticleRetrievalExecutionContext,
  ): Promise<ArticleRetrievalResult> {
    context.signal.throwIfAborted()

    this.handle ??= createHybridArticleRetrievalRuntime(process.env)

    return await this.handle.retriever.retrieve(input, context)
  }

  async onModuleDestroy(): Promise<void> {
    const handle = this.handle

    this.handle = undefined
    await handle?.close()
  }
}
