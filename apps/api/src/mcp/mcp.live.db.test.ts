import type { ModelInputItem } from '@agent/ai'
import type { Message } from '../generated/prisma/client.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { describe, it, vi } from 'vitest'
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { ContextCompactionService } from '../agent-runtime/context/context-compaction.service.js'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { ChatService } from '../chat/chat.service.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { McpService } from './mcp.service.js'

// 显式 opt-in 才消耗 Google / 模型配额；普通 test:db 不读取本机模型配置、不发公网请求。
describe('MCP 真实 Google 与模型验证', () => {
  it.skipIf(process.env.MCP_LIVE_VALIDATION !== '1')(
    '两用户各自连接，真实模型选择工具，结果落库并进入下一轮出站输入',
    { timeout: 180_000 },
    async () => {
      const testUrl = process.env.TEST_DATABASE_URL
      const sourceUrl = process.env.DATABASE_URL
      assert.ok(testUrl && sourceUrl && testUrl !== sourceUrl)
      assert.ok(['localhost', '127.0.0.1'].includes(new URL(sourceUrl).hostname))
      assert.ok(process.env.MCP_GOOGLE_API_KEY)
      const { Pool } = createRequire(import.meta.url)('pg') as {
        Pool: new (config: { connectionString: string, max: number }) => {
          query: (sql: string) => Promise<unknown>
          end: () => Promise<void>
        }
      }
      const pool = new Pool({ connectionString: testUrl, max: 1 })
      const schema = `mcp_live_${randomUUID().replaceAll('-', '')}`
      const source = new PrismaService(sourceUrl)
      let prisma: PrismaService | undefined
      try {
        await pool.query(`CREATE SCHEMA "${schema}"`)
        await pool.query(`SET search_path TO "${schema}", public`)
        const directory = new URL('../../../../prisma/migrations/', import.meta.url)
        for (const entry of (await readdir(directory)).filter(name => name !== 'migration_lock.toml').sort())
          await pool.query(await readFile(new URL(`${entry}/migration.sql`, directory), 'utf8'))
        const connection = new URL(testUrl)
        connection.searchParams.set('schema', schema)
        connection.searchParams.set('options', `-c search_path=${schema},public`)
        prisma = new PrismaService(connection.toString())
        const modelRow = await source.llmModel.findFirstOrThrow({
          where: {
            visible: true,
            wireName: { contains: 'flash' },
            provider: { family: 'deepseek', enabled: true, baseUrl: { contains: 'api.deepseek.com' } },
          },
          include: { provider: true },
        })
        const env = new LLMRuntimeConfigService()
        const modelConfig = new LlmModelConfigService(source, env)
        const resolved = await modelConfig.resolveModel(modelRow.id)
        const llm = new LLMService(env)
        const recorder = new AgentRunRecorderService(prisma)
        const compaction = new ContextCompactionService(llm, prisma, recorder)
        const runtime = new AgentRuntimeService(
          llm,
          prisma,
          recorder,
          new ToolInvocationService(new ToolRegistryService()),
          compaction,
        )
        const mcp = new McpService(prisma)
        const chat = new ChatService(
          runtime,
          { resolveModel: async () => resolved } as unknown as LlmModelConfigService,
          new ConversationsService(prisma),
          new RuntimeConfigService(prisma, modelConfig),
          undefined,
          undefined,
          mcp,
        )
        const wire: ModelInputItem[][] = []
        const original = llm.chatStream.bind(llm)
        const spy = vi.spyOn(llm, 'chatStream').mockImplementation(async function* (provider, items, options) {
          wire.push(structuredClone(items))
          try {
            yield* original(provider, items, options)
          }
          catch (error) {
            const detail = (
              error as { detail?: { status?: number, error?: { message?: string, type?: string, code?: string } } }
            ).detail
            console.log(
              JSON.stringify({
                liveModelFailure: true,
                model: modelRow.wireName,
                status: detail?.status,
                message: detail?.error?.message?.replaceAll(provider.apiKey, '[REDACTED]'),
                type: detail?.error?.type,
                code: detail?.error?.code,
              }),
            )
            throw error
          }
        })
        const evidence: Array<Record<string, unknown>> = []
        try {
          for (let index = 0; index < 2; index++) {
            const user = await prisma.user.create({
              data: { email: `${schema}-${index}@example.test`, mustChangePassword: false },
            })
            const conversation = await prisma.conversation.create({ data: { userId: user.id, title: 'MCP 真实验证' } })
            await mcp.connect(user.id, 'google-developer-knowledge', {
              'X-Goog-Api-Key': process.env.MCP_GOOGLE_API_KEY!,
            })
            const events: Array<{ type: string }> = []
            const start = wire.length
            for await (const event of await chat.chatStream(
              user.id,
              {
                conversationId: conversation.id,
                ...(index === 1 ? { pluginIds: ['google-developer-knowledge'] } : {}),
                message: index === 1
                  ? '查询 Firebase Authentication 如何接入 Google 登录。查询一次官方文档即可，简短回答并附来源。'
                  : '请调用 Google 开发文档插件的 search_documents 搜索 Search Console 点击与展示的定义。读取一次搜索结果即可，然后用两句话解释差异并提供官方来源链接。不要调用其他工具。',
              },
              { signal: AbortSignal.timeout(75_000) },
            ))
              events.push(event)
            assert.ok(
              events.some(event => event.type === 'done'),
              JSON.stringify(events.filter(event => event.type === 'error')),
            )
            assert.ok(!events.some(event => event.type === 'error'))
            const run = await prisma.agentRun.findFirstOrThrow({ where: { conversationId: conversation.id } })
            if (index === 1) {
              const userMessage: Message = await prisma.message.findUniqueOrThrow({ where: { id: run.userMessageId } })
              assert.deepEqual(userMessage.plugins, [{ id: 'google-developer-knowledge', name: 'Google 开发文档' }])
              assert.ok(wire[start]?.some(item => item.type === 'message' && item.role === 'user' && typeof item.content === 'string' && item.content.includes('用户本次明确选择了')))
              const sampling = await prisma.agentStep.findFirstOrThrow({ where: { runId: run.id, type: 'model_sampling' } })
              assert.ok((sampling.input as Record<string, unknown>).pluginSelection)
            }
            const steps = await prisma.agentStep.findMany({
              where: { runId: run.id, type: 'tool_execution', status: 'COMPLETED' },
            })
            const tool = steps.find((step) => {
              const input = step.input as { toolName?: string } | null
              const output = step.output as { ok?: boolean } | null
              return input?.toolName?.startsWith('mcp_') && output?.ok
            })
            assert.ok(tool)
            const output = tool.output as { observation: string }
            assert.ok(output.observation.length > 0)
            assert.ok(
              wire
                .slice(start + 1)
                .some(items =>
                  items.some(item => item.type === 'tool_result' && item.content === output.observation),
                ),
            )
            evidence.push({
              runId: run.id,
              userId: user.id,
              toolStepId: tool.id,
              model: modelRow.wireName,
              observationChars: output.observation.length,
              samplingRequests: wire.length - start,
            })
            await mcp.disconnect(user.id, 'google-developer-knowledge')
          }
          await writeFile('/tmp/issue254-real-model-evidence.json', JSON.stringify(evidence, null, 2))
        }
        finally {
          spy.mockRestore()
        }
      }
      finally {
        await source.$disconnect()
        await prisma?.$disconnect()
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await pool.end()
      }
    },
  )
})
