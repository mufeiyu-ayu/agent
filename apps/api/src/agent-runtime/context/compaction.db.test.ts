import type {
  ChatStreamOptions,
  MessageInputItem,
  ModelInputItem,
  ModelStreamEvent,
} from '@agent/ai'
import type { AgentStep } from '../../generated/prisma/client.js'
import type { LLMService } from '../../llm/llm.service.js'
import type { DatabaseOperationDeadline, DeadlineTransaction } from '../../prisma/prisma.service.js'
import type { RegisteredTool, ToolResult } from '../../tools/core/tool.types.js'
import type { AgentRuntimeEvent } from '../agent-runtime.types.js'
import type { HistoryStepRow } from './conversation-history.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'
import { LLMContextOverflowError } from '@agent/ai'
import { afterAll, beforeAll, describe, it } from 'vitest'
import { ConversationsService } from '../../conversations/conversations.service.js'
import { MessagesService } from '../../conversations/messages.service.js'
import {
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../../generated/prisma/client.js'
import { createResolvedLlmModel } from '../../llm/__fixtures__.js'
import { DatabaseOperationDeadlineExceededError, PrismaService } from '../../prisma/prisma.service.js'
import { createRuntimeConfigSnapshot } from '../../runtime-config/__fixtures__.js'
import { ToolInvocationService } from '../../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../../tools/core/tool-registry.service.js'
import { TOOL_DEFINITIONS } from '../../tools/tool-definitions.js'
import { webFetchDefinition } from '../../tools/web/web-fetch.tool.js'
import { AgentRuntimeService } from '../agent-runtime.service.js'
import { AgentRunRecorderService } from '../lifecycle/agent-run-recorder.service.js'
import { SUMMARIZATION_SYSTEM_PROMPT } from './compaction.js'
import { ContextCompactionService } from './context-compaction.service.js'
import {
  historyItems,
  historySummaryMessage,
  loadConversationHistory,
  pairHistory,
  restoreGroups,
  turnSummaryMessage,
} from './conversation-history.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl)
  throw new Error('缺少 TEST_DATABASE_URL：先 docker compose --profile integration up -d postgres-test，再按 .env.example 在根目录 .env 配置')
if (testDatabaseUrl === process.env.DATABASE_URL?.trim())
  throw new Error('TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行真实库测试')

const MIGRATIONS_DIR = new URL('../../../../../prisma/migrations/', import.meta.url)
const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string, max: number }) => {
    query: (text: string) => Promise<unknown>
    end: () => Promise<void>
  }
}

/** 触发线 4,000：用例按粗估（ASCII 每 4 个字符 1 token）构造体积；保留预算 min(20,000, 1,000)，块预算 2,000，预压线 3,200。 */
const MODEL = { ...createResolvedLlmModel(), maxInputTokens: 4_000 }
const RUNTIME_CONFIG = createRuntimeConfigSnapshot({ limits: { runDeadlineMs: 60_000 } })
/** 与 runtime 发给模型的工具定义同一形状（约 190 token）：检查点 B 的估算要带上它。 */
const MODEL_TOOLS = TOOL_DEFINITIONS.map(definition => ({
  name: definition.name,
  description: definition.description,
  inputSchema: definition.input.schema,
}))
/** 约 1,500 token 的系统提示词：让检查点 B 的估算越过预压线，而要摘要的历史仍在一块之内。 */
const LONG_INSTRUCTIONS: MessageInputItem[] = [{ type: 'message', role: 'system', content: 's'.repeat(6_000) }]

type SamplingStream = (signal: AbortSignal | undefined) => AsyncGenerator<ModelStreamEvent>
type SummaryStream = (request: string) => AsyncGenerator<ModelStreamEvent>

describe('上下文压缩（真实库，#220）', { timeout: 60_000 }, () => {
  const schema = `compaction_test_${randomUUID().replaceAll('-', '')}`
  const adminPool = new PgPool({ connectionString: testDatabaseUrl, max: 1 })
  let prisma: PrismaService

  beforeAll(async () => {
    assert.match(schema, /^compaction_test_[a-f\d]+$/)
    await adminPool.query(`CREATE SCHEMA "${schema}"`)
    await adminPool.query(`SET search_path TO "${schema}", public`)
    // 按目录顺序应用全部迁移，与 prisma migrate deploy 得到同一份表结构。
    const migrations = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()

    for (const migration of migrations)
      await adminPool.query(await readFile(new URL(`${migration}/migration.sql`, MIGRATIONS_DIR), 'utf8'))

    prisma = new PrismaService(withSearchPath(testDatabaseUrl, schema))
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    assert.match(schema, /^compaction_test_[a-f\d]+$/)
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await adminPool.end()
  })

  it('AC-05 / AC-08(j) 只凭库里的压缩记录、Message、Step 与 contextPlan 重建出每次采样的输入：本 Run 内的本轮压缩、做过本轮压缩的组、边界组退回形式；摘要含 U+0000 时落库与回填一致', async () => {
    const conversationId = await createConversation()
    const turnSummary = '## Original Request\n- 读三篇\u0000'
    const historySummary = '## Goal\n- 历史摘要\u0000\uD83D'
    const pages = ['1', '2', '3'].map(page => ({ page, content: page.padEnd(6_000, 'w') }))

    // 第 0 问：一问一答。
    const first = await ask(conversationId, '第 0 问', { sampling: [answerStream('a'.repeat(400))] })
    // 第 1 问：三轮读网页，第 4 次调用前超触发线，把前两轮写成前缀摘要（历史只有很小的第 0 问，不压历史）。
    const second = await ask(conversationId, '读三篇资料', {
      sampling: [
        ...pages.map(({ page }) => () => toModelStream([
          ...(page === '1' ? [{ type: 'text_delta', delta: '先读第一篇。' } as const] : []),
          toolCallEvent(`call-${page}`, 'web_fetch', `{"url":"https://a.example/${page}"}`, `想读 ${page}`),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ])),
        answerStream('三篇都读完了。'),
      ],
      webFetch: index => ({ ok: true, modelContent: pages[index]!.content }),
      summary: () => textStream(turnSummary),
    })
    // 第 2 问：历史里第 1 问按压缩后的样子还原。
    const third = await ask(conversationId, '第 2 问', { sampling: [answerStream('b'.repeat(1_200))] })
    // 第 3 问很长：超触发线，压历史；第 1 问是边界组，以「问题 + 回答全文」保留，第 0 问进摘要。
    const longQuestion = 'q'.repeat(8_000)
    const fourth = await ask(conversationId, longQuestion, { summary: () => textStream(historySummary) })
    const fifth = await ask(conversationId, '第 4 问')

    const persistedTurnSummary = '## Original Request\n- 读三篇�'
    const persistedHistorySummary = '## Goal\n- 历史摘要��'
    const turnStep = await prisma.agentStep.findFirstOrThrow({ where: { runId: second.runId, type: 'context_compaction' } })
    const [record, ...otherRecords] = await prisma.conversationCompaction.findMany({ where: { conversationId } })

    assert.deepEqual([turnStep.status, turnStep.input, (turnStep.output as { summary: string }).summary], [
      AgentStepStatus.COMPLETED,
      { kind: 'turn', keptFromSamplingAttemptId: `${second.runId}:sampling-3` },
      persistedTurnSummary,
    ])
    assert.deepEqual(otherRecords, [])
    assert.deepEqual(
      [record?.runId, record?.reason, record?.summary, record?.coveredGroupIds, record?.answerOnlyGroupId],
      [fourth.runId, 'threshold', persistedHistorySummary, [first.questionId], second.questionId],
    )

    // 本 Run 内：当前问题原样，前缀摘要（回填的是落库后的文本），保留的最后一轮带原文思考。
    const keptRound: ModelInputItem[] = [
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-3', name: 'web_fetch', rawArgumentsJson: '{"url":"https://a.example/3"}' }],
        reasoningContent: '想读 3',
      },
      { type: 'tool_result', callId: 'call-3', name: 'web_fetch', content: pages[2]!.content, ok: true },
    ]

    assert.deepEqual(second.samplingCalls[3], [
      userMessage('第 0 问'),
      assistantMessage('a'.repeat(400)),
      userMessage('读三篇资料'),
      turnSummaryMessage(persistedTurnSummary),
      ...keptRound,
    ])
    // 之后的问答：第 1 问按压缩后的样子还原，思考给空串，最终回答去掉第一轮的中间文本。
    const compactedGroup: ModelInputItem[] = [
      userMessage('读三篇资料'),
      turnSummaryMessage(persistedTurnSummary),
      { ...keptRound[0]!, reasoningContent: '' } as ModelInputItem,
      keptRound[1]!,
      assistantMessage('三篇都读完了。'),
    ]

    assert.deepEqual(third.samplingCalls[0], [
      userMessage('第 0 问'),
      assistantMessage('a'.repeat(400)),
      ...compactedGroup,
      userMessage('第 2 问'),
    ])
    assert.deepEqual(third.summaryRequests, [], '按压缩后形态还原，不调用摘要模型')
    // 历史压缩之后：摘要 + 边界组（问题 + 回答全文）+ 未覆盖的组。
    const afterCompaction: ModelInputItem[] = [
      historySummaryMessage(persistedHistorySummary),
      userMessage('读三篇资料'),
      assistantMessage('先读第一篇。\n\n三篇都读完了。'),
      userMessage('第 2 问'),
      assistantMessage('b'.repeat(1_200)),
    ]

    assert.deepEqual(fourth.samplingCalls[0], [...afterCompaction, userMessage(longQuestion)])
    assert.deepEqual(fifth.samplingCalls[0], [...afterCompaction, userMessage(longQuestion), assistantMessage('好的。'), userMessage('第 4 问')])

    // 每一次采样都能只凭库里的记录重建出来。
    for (const turn of [first, second, third, fourth, fifth]) {
      const samplingSteps = await prisma.agentStep.findMany({ where: { runId: turn.runId, type: 'model_sampling' }, orderBy: { sequence: 'asc' } })

      assert.equal(samplingSteps.length, turn.samplingCalls.length)
      for (const [index, step] of samplingSteps.entries())
        assert.deepEqual(await rebuildSamplingInput(step), turn.samplingCalls[index], `${turn.runId} 第 ${index + 1} 次采样`)
    }
  })

  it('AC-06 检查点 C 真实落库：失败的采样 Step 以 llm_context_overflow 收口，强制压缩后重试成功；刷新后的时间线只有重试那次的思考，下一次问答照常还原', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com` } })
    const conversationId = (await prisma.conversation.create({ data: { title: 'overflow integration', userId: user.id } })).id

    // 4 组约 1,612 token：估算没超触发线，检查点 A 不压；服务商按自己的上限报超长。
    for (let index = 1; index <= 4; index += 1)
      await seedGroup(conversationId, index)

    const retried = await ask(conversationId, '第 5 问', {
      sampling: [
        // 响应开始之前就报超长，没推出任何 delta。
        async function* () {
          yield* []
          throw new LLMContextOverflowError(400)
        },
        () => toModelStream([
          { type: 'reasoning_started' },
          { type: 'reasoning_delta', delta: '重试后想了想。' },
          { type: 'text_delta', delta: '好的。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
    })
    const steps = await prisma.agentStep.findMany({ where: { runId: retried.runId }, orderBy: { sequence: 'asc' } })
    const [record] = await prisma.conversationCompaction.findMany({ where: { conversationId } })

    assert.deepEqual(steps.map(step => [step.type, step.status, (step.output as { errorCode?: string } | null)?.errorCode ?? null]), [
      ['load_conversation_history', AgentStepStatus.COMPLETED, null],
      ['model_sampling', AgentStepStatus.FAILED, 'llm_context_overflow'],
      ['context_compaction', AgentStepStatus.COMPLETED, null],
      ['model_sampling', AgentStepStatus.COMPLETED, null],
      ['assistant_output', AgentStepStatus.COMPLETED, null],
    ])
    assert.deepEqual([record?.reason, record?.runId], ['overflow', retried.runId])
    assert.equal(readContextPlan(steps[3]!).compactionId, record?.id)
    assert.equal((await prisma.agentRun.findUniqueOrThrow({ where: { id: retried.runId } })).errorCode, null)

    const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(user.id, conversationId)

    assert.deepEqual(messages.at(-1)?.activity?.items, [{ kind: 'thought', text: '重试后想了想。' }])

    const next = await ask(conversationId, '第 6 问')

    assert.deepEqual(next.samplingCalls[0]!.slice(-3), [userMessage('第 5 问'), assistantMessage('好的。'), userMessage('第 6 问')])
    assert.equal(readContextPlan(await firstSamplingStep(next.runId)).compactionId, record?.id)
  })

  it('AC-08(c) 并发压缩：检查点 B 与下一次问答的 A 同时压、两个 Run 基于同一份旧记录各自覆盖不同的组；无论哪条记录的 readAt 更新，下一次问答都不丢组、不重复', async () => {
    /** R0 覆盖第 1 问；第 2～6 问是 5 组约 403 token 的问答，第 6 问可以还在进行中。 */
    async function seedConversation(sixthStatus: AgentRunStatus = AgentRunStatus.COMPLETED) {
      const conversationId = await createConversation()
      const groups = []

      for (let index = 1; index <= 6; index += 1)
        groups.push(await seedGroup(conversationId, index, index === 6 ? sixthStatus : AgentRunStatus.COMPLETED))
      await prisma.conversationCompaction.create({
        data: {
          conversationId,
          reason: 'threshold',
          summary: '覆盖：第 1 问',
          coveredGroupIds: [groups[0]!.questionId],
          readAt: seedTime(3_600),
          tokensBefore: 5_000,
          modelId: MODEL.modelId,
        },
      })
      return { conversationId, groups }
    }

    const records = (conversationId: string) => prisma.conversationCompaction.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } })
    const questionsUpTo = (last: number) => Array.from({ length: last }, (_, index) => `第 ${index + 1} 问`)
    // 检查点 A 要超触发线：第 7 问带上约 300 token 的正文。
    const seventh = `第 7 问${'q'.repeat(1_200)}`

    // (1) B 先读快照、A 后读：A 的记录 readAt 更新；B 卡在摘要调用里，等 A 写完才插入。
    {
      const { conversationId, groups } = await seedConversation()
      const gate = createDeferred()
      const started = createDeferred()
      const background = createCompactionService(async function* (request) {
        started.resolve()
        await gate.promise
        yield* echoSummary(request)
      }).compactAfterRun({ runId: groups[5]!.runId, conversationId, model: MODEL, runtimeConfig: RUNTIME_CONFIG, instructions: LONG_INSTRUCTIONS, tools: MODEL_TOOLS })

      await started.promise
      await sleep(5)
      const withA = await ask(conversationId, seventh, { instructions: LONG_INSTRUCTIONS })

      gate.resolve()
      await background
      await withA.afterRun

      const [, fromA, fromB] = await records(conversationId)
      const next = await ask(conversationId, '第 8 问', { instructions: LONG_INSTRUCTIONS })

      assert.deepEqual([fromA?.reason, fromB?.reason], ['threshold', 'after_run'])
      assert.ok(fromA!.readAt > fromB!.readAt && fromA!.createdAt < fromB!.createdAt, 'B 插入更晚、快照更早')
      assert.equal(readContextPlan(await firstSamplingStep(next.runId)).compactionId, fromA?.id)
      assertEachQuestionOnce(next.samplingCalls[0]!, [...questionsUpTo(6), seventh])
    }

    // (2) A 先读快照、B 后读：B 的记录 readAt 更新；A 卡在摘要调用里，等 B 写完才插入。B 的快照里第 7 问还在进行，不进摘要。
    {
      const { conversationId, groups } = await seedConversation()
      const gate = createDeferred()
      const started = createDeferred()
      const withA = ask(conversationId, seventh, {
        instructions: LONG_INSTRUCTIONS,
        async* summary(request) {
          started.resolve()
          await gate.promise
          yield* echoSummary(request)
        },
      })

      await started.promise
      await sleep(5)
      await createCompactionService().compactAfterRun({ runId: groups[5]!.runId, conversationId, model: MODEL, runtimeConfig: RUNTIME_CONFIG, instructions: LONG_INSTRUCTIONS, tools: MODEL_TOOLS })
      gate.resolve()
      await (await withA).afterRun

      const [, fromB, fromA] = await records(conversationId)
      const next = await ask(conversationId, '第 8 问', { instructions: LONG_INSTRUCTIONS })

      assert.deepEqual([fromA?.reason, fromB?.reason], ['threshold', 'after_run'])
      assert.ok(fromB!.readAt > fromA!.readAt && fromB!.createdAt < fromA!.createdAt, 'A 插入更晚、快照更早')
      assert.ok(!fromB!.coveredGroupIds.includes((await withA).questionId), 'B 读取时第 7 问还在进行')
      assert.equal(readContextPlan(await firstSamplingStep(next.runId)).compactionId, fromB?.id)
      assertEachQuestionOnce(next.samplingCalls[0]!, [...questionsUpTo(6), seventh])
    }

    // (3) 两个 Run 同时压：第 7 问读取时第 6 问还在进行（少覆盖一组），第 8 问读取时它已完成（多覆盖一组）；
    // 第 8 问的记录先插入、readAt 更新。只看这两次压缩：两个 Run 结束后的检查点 B 不发起。
    {
      const { conversationId, groups } = await seedConversation(AgentRunStatus.RUNNING)
      const gate = createDeferred()
      const started = createDeferred()
      const longSeventh = `第 7 问${'q'.repeat(3_000)}`
      const seventhRun = ask(conversationId, longSeventh, {
        instructions: LONG_INSTRUCTIONS,
        skipAfterRun: true,
        async* summary(request) {
          started.resolve()
          await gate.promise
          yield* echoSummary(request)
        },
      })

      await started.promise
      await finishGroup(groups[5]!, 6, AgentRunStatus.COMPLETED)
      await sleep(5)
      const eighthRun = await ask(conversationId, '第 8 问', { instructions: LONG_INSTRUCTIONS, skipAfterRun: true })

      gate.resolve()
      await seventhRun

      const [, fromEighth, fromSeventh] = await records(conversationId)
      const next = await ask(conversationId, '第 9 问', { instructions: LONG_INSTRUCTIONS })

      assert.deepEqual([fromSeventh?.runId, fromEighth?.runId], [(await seventhRun).runId, eighthRun.runId])
      assert.deepEqual(fromSeventh?.coveredGroupIds, groups.slice(0, 3).map(group => group.questionId))
      assert.deepEqual(fromEighth?.coveredGroupIds, groups.slice(0, 4).map(group => group.questionId))
      assert.ok(fromEighth!.readAt > fromSeventh!.readAt, '第 8 问的快照更新')
      assert.equal(readContextPlan(await firstSamplingStep(next.runId)).compactionId, fromEighth?.id)
      assertEachQuestionOnce(next.samplingCalls[0]!, [...questionsUpTo(6), longSeventh, '第 8 问'])
      await next.afterRun
    }
  })

  it('AC-08(d) 读取与 Run 完成交错提交：同一个快照里看到的要么全是完成前、要么全是完成后，进行中的组不会被当成「已结束、没有回答」', async () => {
    const conversationId = await createConversation()
    const answered = await seedGroup(conversationId, 1)
    const running = await seedGroup(conversationId, 2, AgentRunStatus.RUNNING)
    const gate = createDeferred()
    const paused = createDeferred()
    // 读完消息之后、读 Run 之前停住（第 4 条查询），这时另一个连接提交 Run 完成。
    const pausing = {
      withDeadlineTransaction: <T>(
        deadline: DatabaseOperationDeadline,
        callback: (transaction: DeadlineTransaction) => Promise<T>,
        onCommitOwned: (() => void) | undefined,
        options: Parameters<PrismaService['withDeadlineTransaction']>[3],
      ) => prisma.withDeadlineTransaction(deadline, (transaction) => {
        let queries = 0

        return callback({
          execute: async (operation) => {
            queries += 1
            if (queries === 4) {
              paused.resolve()
              await gate.promise
            }
            return await transaction.execute(operation)
          },
        })
      }, onCommitOwned, options),
    } as unknown as PrismaService
    const reading = loadConversationHistory(pausing, conversationId, undefined, databaseDeadline())

    await paused.promise
    await finishGroup(running, 2, AgentRunStatus.COMPLETED)
    gate.resolve()

    const { history: interleaved } = await reading
    const { history: after } = await loadConversationHistory(prisma, conversationId, undefined, databaseDeadline())
    const pick = (groups: typeof after.groups) => groups.map(group => [group.key, group.summarizable, group.answered])

    assert.deepEqual(pick(interleaved.groups), [[answered.questionId, true, true], [running.questionId, false, false]])
    assert.deepEqual(pick(after.groups), [[answered.questionId, true, true], [running.questionId, true, true]])
  })

  it('AC-08(d) 压缩时还在进行的组之后完成、失败或被停止：不在覆盖集合里，之后的历史照 #218 规则还原，不出现半截内容', async () => {
    for (const status of [AgentRunStatus.COMPLETED, AgentRunStatus.FAILED, AgentRunStatus.ABORTED]) {
      const conversationId = await createConversation()
      // 最早的一组还在进行（卡住或并发）：若被当成已结束，它会最先进摘要。
      const running = await seedGroup(conversationId, 0, AgentRunStatus.RUNNING)
      const groups = []

      for (let index = 1; index <= 4; index += 1)
        groups.push(await seedGroup(conversationId, index))

      // 第 4 问结束后的检查点 B：第 0 问只有问题、不进摘要。
      await createCompactionService().compactAfterRun({ runId: groups[3]!.runId, conversationId, model: MODEL, runtimeConfig: RUNTIME_CONFIG, instructions: LONG_INSTRUCTIONS, tools: MODEL_TOOLS })
      await finishGroup(running, 0, status, { withTools: true })

      const { history } = await loadConversationHistory(prisma, conversationId, undefined, databaseDeadline())
      const [record] = await prisma.conversationCompaction.findMany({ where: { conversationId } })

      assert.deepEqual(record?.coveredGroupIds, groups.slice(0, 2).map(group => group.questionId), status)
      assert.deepEqual(historyItems(history), [
        historySummaryMessage(record!.summary),
        userMessage('第 0 问'),
        // 完成：带回工具记录；失败 / 停止：只留问题。
        ...(status === AgentRunStatus.COMPLETED
          ? [
            { type: 'assistant_tool_call', calls: [{ callId: 'call-0', name: 'web_search', rawArgumentsJson: '{"query":"seo"}' }], reasoningContent: '', content: '先查。' },
            { type: 'tool_result', callId: 'call-0', name: 'web_search', content: '搜索结果', ok: true },
            assistantMessage('查到了。'),
          ] satisfies ModelInputItem[]
          : []),
        ...[3, 4].flatMap(index => [userMessage(`第 ${index} 问`), assistantMessage(`${index}`.padEnd(1_600, 'x'))]),
      ], status)
    }
  })

  it('AC-08(e2) 检查点 A 中途压历史：快照里进行中的组在压缩时已完成，也不进摘要与覆盖集合，下一次问答能看到它的回答；当前问题之后才完成的问答不进本 Run 的摘要', async () => {
    const conversationId = await createConversation()
    // 最早的一组在本 Run 读历史时还在进行；若按最新状态重读，它会最先被摘要。
    const early = await seedGroup(conversationId, 0, AgentRunStatus.RUNNING)
    const groups = []

    for (let index = 1; index <= 4; index += 1)
      groups.push(await seedGroup(conversationId, index))

    const pages = ['1', '2'].map(page => page.padEnd(6_000, 'w'))
    // 只看检查点 A：本 Run 结束后的检查点 B 不发起，下一次问答读到的仍是本 Run 写的记录。
    const current = await ask(conversationId, '读两篇资料', {
      skipAfterRun: true,
      sampling: [
        ...['1', '2'].map(page => () => toModelStream([
          toolCallEvent(`call-${page}`, 'web_fetch', `{"url":"https://a.example/${page}"}`),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ])),
        answerStream('两篇都读完了。'),
      ],
      // 第一轮工具执行期间：最早那组完成；另一个对话窗口在当前问题之后问了一句并已答完。
      webFetch: async (index) => {
        if (index === 0) {
          await finishGroup(early, 0, AgentRunStatus.COMPLETED)
          await seedGroup(conversationId, 99, AgentRunStatus.COMPLETED, new Date())
        }
        return { ok: true, modelContent: pages[index]! }
      },
    })
    const [record] = await prisma.conversationCompaction.findMany({ where: { conversationId } })
    const [historyRequest] = current.summaryRequests

    assert.deepEqual(record?.coveredGroupIds, groups.slice(0, 2).map(group => group.questionId))
    assert.match(historyRequest ?? '', /第 1 问[\s\S]*第 2 问/)
    assert.doesNotMatch(historyRequest ?? '', /第 0 问|第 99 问/)
    // 本 Run 之后还压了本轮：只剩最新一轮原文。
    assert.deepEqual(
      (await prisma.agentStep.findMany({ where: { runId: current.runId, type: 'context_compaction' }, orderBy: { sequence: 'asc' } }))
        .map(step => [(step.input as { kind: string }).kind, step.status]),
      [['history', AgentStepStatus.COMPLETED], ['turn', AgentStepStatus.COMPLETED]],
    )

    const next = await ask(conversationId, '第 100 问')
    const input = next.samplingCalls[0]!

    assert.deepEqual(input.slice(0, 3), [historySummaryMessage(record!.summary), userMessage('第 0 问'), assistantMessage('0'.padEnd(1_600, 'x'))])
    assert.ok(input.some(item => item.type === 'message' && item.content === '第 99 问'), '后到的问答照常出现在下一次问答里')
  })

  // ── 脚手架 ──────────────────────────────────────────────

  /** 一次真实问答：真实 runtime、recorder、压缩服务与库；模型流与 web_fetch 是假的，摘要调用按系统提示词认出来单独给流。 */
  async function ask(conversationId: string, userContent: string, options: {
    /** 各次采样的模型流；不给时一轮直接回答「好的。」。 */
    sampling?: SamplingStream[]
    /** 摘要调用的模型流；不给时回显覆盖了哪些问题。 */
    summary?: SummaryStream
    instructions?: MessageInputItem[]
    webFetch?: (index: number) => ToolResult | Promise<ToolResult>
    /** 检查点 B 不发起（模拟不需要它的场景）。 */
    skipAfterRun?: boolean
  } = {}) {
    const samplingStreams = options.sampling ?? [answerStream('好的。')]
    const samplingCalls: ModelInputItem[][] = []
    const summaryRequests: string[] = []
    const llmService = createLlmService({
      sampling: (messages, signal) => {
        const stream = samplingStreams[samplingCalls.length]

        samplingCalls.push(structuredClone(messages))
        if (!stream)
          throw new Error(`测试未提供第 ${samplingCalls.length} 次采样的模型流`)
        return stream(signal)
      },
      summary: (request) => {
        summaryRequests.push(request)
        return (options.summary ?? echoSummary)(request)
      },
    })
    const registry = new ToolRegistryService()
    let fetches = 0

    registry.register({
      definition: webFetchDefinition,
      executor: { execute: async () => await (options.webFetch ?? (() => ({ ok: true, modelContent: '网页正文' })))(fetches++) },
    } as unknown as RegisteredTool)

    const recorder = new AgentRunRecorderService(prisma)
    const compaction = new ContextCompactionService(llmService, prisma, recorder)
    let afterRun: Promise<void> = Promise.resolve()

    // 检查点 B 不被 runtime await：记下它的 Promise，用例需要时等它跑完。
    compaction.compactAfterRun = (input) => {
      afterRun = options.skipAfterRun ? Promise.resolve() : ContextCompactionService.prototype.compactAfterRun.call(compaction, input)
      return afterRun
    }

    const runtime = new AgentRuntimeService(llmService, prisma, recorder, new ToolInvocationService(registry), compaction)
    const events: AgentRuntimeEvent[] = []

    for await (const event of runtime.runTurnStream({
      conversationId,
      userContent,
      model: MODEL,
      runtimeConfig: RUNTIME_CONFIG,
      instructions: options.instructions ?? [],
    })) {
      events.push(event)
    }

    const started = events.find(event => event.type === 'run_started')

    assert.equal(events.at(-1)?.type, 'run_completed', JSON.stringify(events.at(-1)))
    assert.ok(started?.type === 'run_started')

    return { runId: started.runId, questionId: started.userMessageId, samplingCalls, summaryRequests, afterRun }
  }

  /** 单独的压缩服务：直接调用检查点 B。 */
  function createCompactionService(summary: SummaryStream = echoSummary): ContextCompactionService {
    const llmService = createLlmService({
      sampling: () => {
        throw new Error('检查点 B 不采样')
      },
      summary,
    })

    return new ContextCompactionService(llmService, prisma, new AgentRunRecorderService(prisma))
  }

  /**
   * 只凭库里的记录重建一次采样发给模型的输入（AC-05）：contextPlan 指向的压缩记录与本轮压缩 Step、严格早于问题的
   * 已完成消息与它们的 Step、本 Run 在这次采样之前的采样与工具 Step。系统提示词不落库（范围外），用例都不带。
   */
  async function rebuildSamplingInput(step: AgentStep): Promise<ModelInputItem[]> {
    const plan = readContextPlan(step)
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: step.runId } })
    const question = await prisma.message.findUniqueOrThrow({ where: { id: run.userMessageId } })
    const compaction = plan.compactionId === null
      ? undefined
      : await prisma.conversationCompaction.findUniqueOrThrow({
          where: { id: plan.compactionId },
          select: { id: true, summary: true, coveredGroupIds: true, answerOnlyGroupId: true },
        })
    const messages = await prisma.message.findMany({
      where: {
        conversationId: run.conversationId,
        status: MessageStatus.COMPLETED,
        OR: [{ createdAt: { lt: question.createdAt } }, { createdAt: question.createdAt, id: { lt: question.id } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    const runs = await prisma.agentRun.findMany({
      where: { userMessageId: { in: messages.filter(message => message.role === MessageRole.USER).map(message => message.id) } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, userMessageId: true, assistantMessageId: true, status: true },
    })
    const covered = new Set(compaction?.coveredGroupIds)
    const paired = pairHistory(messages, runs).filter(group => !covered.has(group.key))
    const historySteps = await prisma.agentStep.findMany({
      where: { runId: { in: paired.filter(group => group.key !== compaction?.answerOnlyGroupId).flatMap(group => group.answers.flatMap(answer => answer.runId ? [answer.runId] : [])) } },
    })
    const groups = restoreGroups(paired, historySteps.flatMap(toHistoryStepRow))

    assert.equal(groups.reduce((count, group) => count + group.messageCount, 0), plan.historyIncludedCount, 'historyIncludedCount')

    const runSteps = await prisma.agentStep.findMany({ where: { runId: run.id, sequence: { lt: step.sequence } }, orderBy: { sequence: 'asc' } })
    const turn = runSteps.find(candidate => candidate.id === plan.turnCompactionStepId)
    const keptFrom = (turn?.input as { keptFromSamplingAttemptId?: string } | undefined)?.keptFromSamplingAttemptId
    const rounds: ModelInputItem[] = []
    let keeping = !turn

    for (const sampling of runSteps.filter(candidate => candidate.type === 'model_sampling')) {
      const attempt = (sampling.input as { samplingAttemptId: string }).samplingAttemptId
      const tools = runSteps.filter(candidate => candidate.type === 'tool_execution' && (candidate.input as { samplingAttemptId: string }).samplingAttemptId === attempt)
      const output = sampling.output as { intermediateText?: string, reasoningContent?: string }

      keeping ||= attempt === keptFrom
      if (!keeping || tools.length === 0)
        continue
      rounds.push(
        {
          type: 'assistant_tool_call',
          calls: tools.map(tool => ({ callId: toolInput(tool).callId, name: toolInput(tool).toolName, rawArgumentsJson: toolInput(tool).arguments })),
          // 本 Run 内回填的是原文思考。
          reasoningContent: output.reasoningContent ?? '',
          ...(output.intermediateText ? { content: output.intermediateText } : {}),
        },
        ...tools.map(tool => ({
          type: 'tool_result' as const,
          callId: toolInput(tool).callId,
          name: toolInput(tool).toolName,
          content: (tool.output as { observation: string }).observation,
          ok: (tool.output as { ok?: boolean }).ok === true,
        })),
      )
    }

    return [
      ...historyItems({ readAt: question.createdAt, compaction, groups }),
      userMessage(question.content),
      ...(turn ? [turnSummaryMessage((turn.output as { summary: string }).summary)] : []),
      ...rounds,
    ]
  }

  async function createConversation(): Promise<string> {
    return (await prisma.conversation.create({ data: { title: 'compaction integration' } })).id
  }

  /**
   * 直接写库的一次问答：问题「第 N 问」与它的 Run，完成的带约 400 token 的回答（`N` 后补 x 到 1,600 个字符）。
   * 时间取一天前（给了 `at` 除外），早于用例里真实提问的时刻；进行中的 Run 像 runtime 一样先建好 STREAMING 的回答。
   */
  async function seedGroup(conversationId: string, index: number, status: AgentRunStatus = AgentRunStatus.COMPLETED, at?: Date) {
    const createdAt = at ?? seedTime(index * 2)
    const question = await prisma.message.create({ data: { conversationId, role: MessageRole.USER, content: `第 ${index} 问`, createdAt } })
    const answer = await prisma.message.create({
      data: {
        conversationId,
        role: MessageRole.ASSISTANT,
        content: status === AgentRunStatus.COMPLETED ? `${index}`.padEnd(1_600, 'x') : '',
        status: status === AgentRunStatus.COMPLETED ? MessageStatus.COMPLETED : MessageStatus.STREAMING,
        createdAt: new Date(createdAt.getTime() + 1),
      },
    })
    const run = await prisma.agentRun.create({
      data: { conversationId, userMessageId: question.id, assistantMessageId: answer.id, status, createdAt },
    })

    return { questionId: question.id, answerId: answer.id, runId: run.id }
  }

  /** 进行中的问答结束：回答与 Run 终态在同一个事务里提交（同 completeRun / failRun）；完成时可以带一轮工具记录。 */
  async function finishGroup(
    group: { answerId: string, runId: string },
    index: number,
    status: AgentRunStatus,
    options: { withTools?: boolean } = {},
  ) {
    const completed = status === AgentRunStatus.COMPLETED
    const attempt = `${group.runId}:sampling-1`

    await prisma.$transaction([
      ...(completed && options.withTools
        ? [prisma.agentStep.createMany({
            data: [
              { runId: group.runId, sequence: 1, type: 'model_sampling', title: 'model_sampling', status: AgentStepStatus.COMPLETED, input: { samplingAttemptId: attempt }, output: { toolCallCount: 1, intermediateText: '先查。' } },
              { runId: group.runId, sequence: 2, type: 'tool_execution', title: 'tool_execution', status: AgentStepStatus.COMPLETED, input: { samplingAttemptId: attempt, callId: `call-${index}`, toolName: 'web_search', arguments: '{"query":"seo"}' }, output: { ok: true, observation: '搜索结果' } },
            ],
          })]
        : []),
      prisma.message.update({
        where: { id: group.answerId },
        data: {
          content: completed ? (options.withTools ? '先查。\n\n查到了。' : `${index}`.padEnd(1_600, 'x')) : '半截回答',
          status: completed ? MessageStatus.COMPLETED : status === AgentRunStatus.FAILED ? MessageStatus.FAILED : MessageStatus.ABORTED,
        },
      }),
      prisma.agentRun.update({ where: { id: group.runId }, data: { status, endedAt: new Date() } }),
    ])
  }

  async function firstSamplingStep(runId: string): Promise<AgentStep> {
    return await prisma.agentStep.findFirstOrThrow({ where: { runId, type: 'model_sampling' }, orderBy: { sequence: 'asc' } })
  }
})

function createLlmService(routes: {
  sampling: (messages: ModelInputItem[], signal: AbortSignal | undefined) => AsyncGenerator<ModelStreamEvent>
  summary: SummaryStream
}): LLMService {
  return {
    chatStream: (_provider: unknown, messages: ModelInputItem[], options?: ChatStreamOptions) => {
      const [system, user] = messages

      return system?.type === 'message' && system.content === SUMMARIZATION_SYSTEM_PROMPT && user?.type === 'message'
        ? routes.summary(user.content)
        : routes.sampling(messages, options?.signal)
    },
  } as unknown as LLMService
}

/** 假的摘要模型：摘要 =「覆盖：」+ 旧摘要与这次对话里的全部问题，用来核对每个问题恰好出现一次。 */
async function* echoSummary(request: string): AsyncGenerator<ModelStreamEvent> {
  const previous = /<previous-summary>\n覆盖：(.*)\n<\/previous-summary>/.exec(request)?.[1]?.split('、') ?? []
  const conversation = request.slice(0, request.indexOf('</conversation>'))
  const asked = [...conversation.matchAll(/^\[User\] \([^)]*\): (.*)$/gm)].map(match => match[1]!)

  yield* textStream(`覆盖：${[...previous, ...asked].join('、')}`)
}

/** 下一次问答的输入里，之前的每个问题恰好出现一次：写进了摘要，或原文带着（最后一条是当前问题，不算）。 */
function assertEachQuestionOnce(items: ModelInputItem[], questions: string[]): void {
  const userContents = items.flatMap(item => item.type === 'message' && item.role === 'user' ? [item.content] : []).slice(0, -1)
  const [summary, ...raw] = userContents
  const summarized = /<summary>\n覆盖：(.*)\n<\/summary>/.exec(summary ?? '')?.[1]?.split('、')

  assert.ok(summarized, '第一条是摘要消息')
  assert.deepEqual([...summarized, ...raw].sort(), [...questions].sort())
}

function readContextPlan(step: AgentStep): { compactionId: string | null, turnCompactionStepId: string | null, historyIncludedCount: number } {
  return (step.output as { contextPlan: ReturnType<typeof readContextPlan> }).contextPlan
}

function toolInput(step: AgentStep): { callId: string, toolName: string, arguments: string } {
  return step.input as { callId: string, toolName: string, arguments: string }
}

/** 同 `historyStepsQuery` 的投影：采样、工具与成功的本轮压缩 Step，各类型只取自己的字段。 */
function toHistoryStepRow(step: AgentStep): HistoryStepRow[] {
  const input = (step.input ?? {}) as Record<string, unknown>
  const output = (step.output ?? {}) as Record<string, unknown>
  const sampling = step.type === 'model_sampling'
  const tool = step.type === 'tool_execution'
  const turn = step.type === 'context_compaction' && step.status === AgentStepStatus.COMPLETED && input.kind === 'turn'

  if (!sampling && !tool && !turn)
    return []

  return [{
    runId: step.runId,
    sequence: step.sequence,
    type: step.type,
    samplingAttemptId: input.samplingAttemptId,
    toolCallCount: sampling ? output.toolCallCount : null,
    intermediateText: sampling ? output.intermediateText : null,
    callId: tool ? input.callId : null,
    toolName: tool ? input.toolName : null,
    arguments: tool ? input.arguments : null,
    observation: tool ? output.observation : null,
    ok: tool ? output.ok : null,
    keptFromSamplingAttemptId: turn ? input.keptFromSamplingAttemptId : null,
    summary: turn ? output.summary : null,
  }]
}

function databaseDeadline(): DatabaseOperationDeadline {
  return { deadlineAt: Date.now() + 10_000, createTimeoutError: () => new DatabaseOperationDeadlineExceededError() }
}

const SEED_BASE = Date.now() - 86_400_000

function seedTime(second: number): Date {
  return new Date(SEED_BASE + second * 1_000)
}

function userMessage(content: string): ModelInputItem {
  return { type: 'message', role: 'user', content }
}

function assistantMessage(content: string): ModelInputItem {
  return { type: 'message', role: 'assistant', content }
}

function answerStream(text: string): SamplingStream {
  return () => textStream(text)
}

async function* textStream(text: string): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'text_delta', delta: text }
  yield { type: 'response_completed', finishReason: 'stop' }
}

async function* toModelStream(events: ModelStreamEvent[]): AsyncGenerator<ModelStreamEvent> {
  yield* events
}

function toolCallEvent(callId: string, name: string, argumentsJson: string, reasoningContent = '需要调用工具。'): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: { providerCallId: callId, name, argumentsJson, index: 0 },
    reasoningContent,
  }
}

function createDeferred(): { promise: Promise<void>, resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)

  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
