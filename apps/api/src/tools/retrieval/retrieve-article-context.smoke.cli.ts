import type { ToolResult } from '../core/tool.types.js'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { ACTIVE_EMBEDDING_PROFILE } from '../../embeddings/embedding-provider.js'
import { installOutboundProxyFromEnv } from '../../llm/outbound-proxy.js'
import { createHybridArticleRetrievalRuntime } from '../../retrieval/hybrid-article-retrieval.runtime.js'
import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { normalizeToolObservation } from '../core/tool-observation.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import {
  retrieveArticleContextDefinition,
  RetrieveArticleContextTool,
} from './retrieve-article-context.tool.js'

const SMOKE_QUERY = process.env.RETRIEVAL_TOOL_SMOKE_QUERY?.trim() || 'Wuthering Waves 的 soft pity 是什么'
const SMOKE_DATABASE_TIMEOUT_MS = 60_000

/** 摘要只包含可以安全打印的字段：没有 excerpt、正文、向量、距离和 Provider payload。 */
async function executeRetrieveArticleContextSmoke(
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
) {
  signal.throwIfAborted()
  const runtime = createHybridArticleRetrievalRuntime(env)
  const registry = new ToolRegistryService()

  registry.register({
    definition: retrieveArticleContextDefinition,
    executor: new RetrieveArticleContextTool(runtime.retriever),
  })

  const invocationService = new ToolInvocationService(registry)
  const startedAt = performance.now()
  let result: ToolResult

  try {
    result = await invocationService.invoke(
      {
        callId: 'smoke-call-1',
        toolName: 'retrieve_article_context',
        rawArgumentsJson: JSON.stringify({ query: SMOKE_QUERY, limit: 3 }),
      },
      {
        databaseDeadline: {
          deadlineAt: Date.now() + SMOKE_DATABASE_TIMEOUT_MS,
          signal,
          createTimeoutError: () => new Error('retrieval tool smoke 数据库操作超时'),
        },
        signal,
      },
    )
  }
  finally {
    await runtime.close()
  }

  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt))

  if (!result.ok)
    throw new Error(`retrieval tool smoke 返回失败：${result.code}`)

  // stepSummary 就是工具自己声明的可安全持久化摘要，这里直接复用它的字段。
  const summary = result.stepSummary as unknown as {
    status: string
    answerStatus: string
    strategy: { name: string, version: string }
    sourceCount: number
    chunkEvidenceCount: number
    sources: Array<{ sourceId: number, chunkId?: string }>
  }
  const observation = normalizeToolObservation(
    result.modelContent,
    retrieveArticleContextDefinition.maxObservationChars,
  )

  return {
    tool: 'retrieve_article_context@1',
    embeddingProfile: {
      provider: ACTIVE_EMBEDDING_PROFILE.provider,
      model: ACTIVE_EMBEDDING_PROFILE.model,
      dimensions: ACTIVE_EMBEDDING_PROFILE.dimensions,
      version: ACTIVE_EMBEDDING_PROFILE.version,
    },
    queryChars: [...SMOKE_QUERY].length,
    ok: result.ok,
    status: summary.status,
    answerStatus: summary.answerStatus,
    strategy: summary.strategy,
    sourceCount: summary.sourceCount,
    chunkEvidenceCount: summary.chunkEvidenceCount,
    sourceIds: summary.sources.map(source => source.sourceId),
    chunkIds: summary.sources.flatMap(source => (
      source.chunkId === undefined ? [] : [source.chunkId]
    )),
    observation: {
      maxChars: retrieveArticleContextDefinition.maxObservationChars,
      originalChars: observation.originalChars,
      observationChars: observation.observationChars,
      truncated: observation.truncated,
      untrustedMarked: result.modelContent.includes('untrusted'),
      unverifiedMarked: result.modelContent.includes('answer_status=unverified'),
    },
    elapsedMs,
  }
}

function safeSmokeFailure(error: unknown): { error: string, message: string } {
  return {
    error: error instanceof Error && error.name === 'AbortError'
      ? 'retrieval_tool_smoke_aborted'
      : 'retrieval_tool_smoke_failed',
    message: 'retrieve_article_context smoke 失败',
  }
}

async function main(): Promise<void> {
  const abortController = new AbortController()
  const abort = (): void => abortController.abort(
    new DOMException('retrieval tool smoke aborted', 'AbortError'),
  )
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)

  try {
    // 不经 Nest 启动：embedding 的代理出口在这里装（OUTBOUND_PROXY_URL）。
    installOutboundProxyFromEnv(process.env)
    // smoke 只允许连隔离数据库，避免真实 Provider 调用打到开发库。
    const connectionString = process.env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()

    if (!connectionString) {
      throw new Error(
        'ARTICLE_INDEX_TEST_DATABASE_URL 未配置，retrieval tool smoke 只允许使用隔离数据库',
      )
    }

    const summary = await executeRetrieveArticleContextSmoke(
      abortController.signal,
      { ...process.env, DATABASE_URL: connectionString },
    )

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  }
  catch (error) {
    process.stderr.write(`${JSON.stringify(safeSmokeFailure(error))}\n`)
    process.exitCode = 1
  }
  finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
  void main()
