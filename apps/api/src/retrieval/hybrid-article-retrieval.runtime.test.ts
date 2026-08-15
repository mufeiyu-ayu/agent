import assert from 'node:assert/strict'
import process from 'node:process'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { EmbeddingError } from '../embeddings/embedding-provider.js'
import { DatabaseOperationDeadlineExceededError } from '../prisma/prisma.service.js'
import {
  createHybridArticleRetrievalRuntime,
  HybridArticleRetrievalRuntime,
} from './hybrid-article-retrieval.runtime.js'

describe('HybridArticleRetrievalRuntime', () => {
  it('未调用检索时不解析 Embedding 配置、不创建连接池', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY
    const originalDatabaseUrl = process.env.DATABASE_URL

    delete process.env.GEMINI_API_KEY
    delete process.env.DATABASE_URL

    try {
      const runtime = new HybridArticleRetrievalRuntime()

      // 构造和销毁都不应该触碰 Provider 或数据库。
      await runtime.onModuleDestroy()
      assert.ok(runtime)
    }
    finally {
      restore('GEMINI_API_KEY', originalApiKey)
      restore('DATABASE_URL', originalDatabaseUrl)
    }
  })

  it('已触发的 signal 让检索在初始化 runtime 之前结束', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY

    delete process.env.GEMINI_API_KEY

    try {
      const runtime = new HybridArticleRetrievalRuntime()
      const abortController = new AbortController()

      abortController.abort()

      await assert.rejects(
        runtime.retrieve(
          { query: 'seo', limit: 3 },
          createContext(abortController.signal),
        ),
        { name: 'AbortError' },
      )
    }
    finally {
      restore('GEMINI_API_KEY', originalApiKey)
    }
  })

  it('缺少 DATABASE_URL 时组装失败，且不泄漏配置内容', () => {
    assert.throws(
      () => createHybridArticleRetrievalRuntime({ GEMINI_API_KEY: 'test-key' }),
      /DATABASE_URL/,
    )
  })

  it('缺少 GEMINI_API_KEY 时以 configuration 错误失败，不回退到其他配置', () => {
    assert.throws(
      () => createHybridArticleRetrievalRuntime({
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/agent_ai_seo',
        LLM_API_KEY: 'sk-should-not-be-used',
      }),
      (error: unknown) => (
        error instanceof EmbeddingError
        && error.code === 'configuration'
        && error.retryable === false
      ),
    )
  })

  it('配置齐备时组装出 hybrid_rrf@1 检索链路并可关闭', async () => {
    const runtime = createHybridArticleRetrievalRuntime({
      DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/agent_ai_seo',
      GEMINI_API_KEY: 'test-key',
    })

    try {
      assert.equal(typeof runtime.retriever.retrieve, 'function')
    }
    finally {
      await runtime.close()
    }
  })
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined)
    delete process.env[name]
  else
    process.env[name] = value
}

function createContext(signal: AbortSignal) {
  return {
    signal,
    databaseDeadline: {
      deadlineAt: Date.now() + 60_000,
      signal,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
    },
  }
}
