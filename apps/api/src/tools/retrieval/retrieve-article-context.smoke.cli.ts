import type { ToolResult } from '../core/tool.types.js'
import type { RetrieveArticleContextOutput } from './retrieve-article-context.tool.js'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { ACTIVE_EMBEDDING_PROFILE } from '../../embeddings/embedding-provider.js'
import { createHybridArticleRetrievalRuntime } from '../../retrieval/hybrid-article-retrieval.runtime.js'
import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { normalizeToolObservation } from '../core/tool-observation.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import {
  retrieveArticleContextDefinition,
  RetrieveArticleContextTool,
} from './retrieve-article-context.tool.js'

const SMOKE_QUERY = process.env.RETRIEVAL_TOOL_SMOKE_QUERY?.trim() || 'SEO 标题应该怎么写'
const SMOKE_DATABASE_TIMEOUT_MS = 60_000

/** 只包含可以安全打印的字段：没有 excerpt、正文、向量、距离和 Provider payload。 */
export interface RetrieveArticleContextSmokeSummary {
  tool: 'retrieve_article_context@1'
  embeddingProfile: {
    provider: typeof ACTIVE_EMBEDDING_PROFILE.provider
    model: typeof ACTIVE_EMBEDDING_PROFILE.model
    dimensions: typeof ACTIVE_EMBEDDING_PROFILE.dimensions
    version: typeof ACTIVE_EMBEDDING_PROFILE.version
  }
  queryChars: number
  ok: boolean
  status: RetrieveArticleContextOutput['status']
  answerStatus: RetrieveArticleContextOutput['answerStatus']
  strategy: RetrieveArticleContextOutput['strategy']
  sourceCount: number
  chunkEvidenceCount: number
  sourceIds: number[]
  chunkIds: string[]
  observation: {
    maxChars: number
    originalChars: number
    observationChars: number
    truncated: boolean
    untrustedMarked: boolean
    unverifiedMarked: boolean
  }
  elapsedMs: number
}

export async function executeRetrieveArticleContextSmoke(
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RetrieveArticleContextSmokeSummary> {
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
        samplingAttemptId: 'smoke-sampling-1',
      },
      {
        runId: 'smoke-run-1',
        conversationId: 'smoke-conversation-1',
        databaseDeadline: {
          deadlineAt: Date.now() + SMOKE_DATABASE_TIMEOUT_MS,
          signal,
          createTimeoutError: () => new Error('retrieval tool smoke 数据库操作超时'),
        },
        signal,
        executionAttempt: 1,
      },
    )
  }
  finally {
    await runtime.close()
  }

  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt))

  if (!result.ok)
    throw new Error(`retrieval tool smoke 返回失败：${result.code}`)

  const data = result.data as RetrieveArticleContextOutput
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
    status: data.status,
    answerStatus: data.answerStatus,
    strategy: data.strategy,
    sourceCount: data.sourceCount,
    chunkEvidenceCount: data.sources.filter(source => source.evidence).length,
    sourceIds: data.sources.map(source => source.sourceId),
    chunkIds: data.sources.flatMap(source => (
      source.evidence ? [source.evidence.chunkId] : []
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

export function safeSmokeFailure(error: unknown): { error: string, message: string } {
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
