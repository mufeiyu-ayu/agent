import type { Message, MessageRole, Prisma } from '../../generated/prisma/client.js'
import type {
  DatabaseOperationDeadline,
  DeadlineTransaction,
  PrismaService,
} from '../../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Recorder 引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  AgentRunStatus,
  AgentStepStatus,
  MessageStatus,
} from '../../generated/prisma/client.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'

const TEST_DEADLINE: DatabaseOperationDeadline = {
  deadlineAt: Number.MAX_SAFE_INTEGER,
  createTimeoutError: () => new Error('测试数据库操作超时'),
}

describe('AgentRunRecorderService', () => {
  it('同一 Run 可以创建两条独立 model_sampling', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')

    const first = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)
    const second = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)

    assert.notEqual(first.id, second.id)
    assert.equal(first.status, AgentStepStatus.RUNNING)
    assert.equal(second.status, AgentStepStatus.RUNNING)
  })

  it('两条相同 type 的 Step 能按不同 stepId 分别完成', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')
    const first = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)
    const second = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)

    await harness.recorder.completeStep(first.id, TEST_DEADLINE, {
      output: { finishReason: 'tool_calls' },
    })

    assert.equal(harness.step(first.id)?.status, AgentStepStatus.COMPLETED)
    assert.equal(harness.step(second.id)?.status, AgentStepStatus.RUNNING)

    await harness.recorder.completeStep(second.id, TEST_DEADLINE, {
      output: { finishReason: 'stop' },
    })
    assert.equal(harness.step(second.id)?.status, AgentStepStatus.COMPLETED)
  })

  it('同一个 Step 的第二次 terminal transition 被明确拒绝', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')
    const completed = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)
    const failed = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.toolExecution,
    }, TEST_DEADLINE)
    const aborted = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.assistantOutput,
    }, TEST_DEADLINE)

    await harness.recorder.completeStep(completed.id, TEST_DEADLINE)
    await harness.recorder.failStep(failed.id, TEST_DEADLINE, { errorMessage: '安全失败' })
    await harness.recorder.abortStep(aborted.id, TEST_DEADLINE)

    await assertRecorderInvariant(() => harness.recorder.failStep(completed.id, TEST_DEADLINE, {
      errorMessage: '迟到失败',
    }))
    await assertRecorderInvariant(() => harness.recorder.abortStep(failed.id, TEST_DEADLINE))
    await assertRecorderInvariant(() => harness.recorder.completeStep(aborted.id, TEST_DEADLINE))
  })

  it('completeRun 在一个事务内完成 Message、assistant Step 和 Run', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('completed')
    let commitOwned = false

    const message = await harness.recorder.completeRun({
      ...prepared.completion,
      content: '最终回答',
      output: { contentLength: 4 },
    }, TEST_DEADLINE, () => {
      assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.COMPLETED)
      assert.equal(harness.step(prepared.assistantStep.id)?.status, AgentStepStatus.COMPLETED)
      assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.COMPLETED)
      commitOwned = true
    })

    assert.equal(commitOwned, true)
    assert.equal(message.status, MessageStatus.COMPLETED)
    assert.equal(message.content, '最终回答')
    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.COMPLETED)
    assert.equal(harness.step(prepared.assistantStep.id)?.status, AgentStepStatus.COMPLETED)
    assert.deepEqual(harness.step(prepared.assistantStep.id)?.output, { contentLength: 4 })
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.COMPLETED)
    assert.equal(harness.unfinishedSteps(prepared.run.id).length, 0)
  })

  it('completeRun 发现其他 RUNNING Step 时整笔回滚', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('unfinished')
    const unfinished = await harness.recorder.startStep({
      runId: prepared.run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)

    await assertRecorderInvariant(() => harness.recorder.completeRun({
      ...prepared.completion,
      content: '不应提交',
    }, TEST_DEADLINE))

    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.STREAMING)
    assert.equal(harness.step(prepared.assistantStep.id)?.status, AgentStepStatus.RUNNING)
    assert.equal(harness.step(unfinished.id)?.status, AgentStepStatus.RUNNING)
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.RUNNING)
  })

  it('completeRun 在 Run CAS 失败时不留下部分终态', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('completion-failure')
    let commitOwned = false

    harness.failNextTransactionAt(7)
    await assert.rejects(() => harness.recorder.completeRun({
      ...prepared.completion,
      content: '不应提交',
    }, TEST_DEADLINE, () => {
      commitOwned = true
    }), /injected transaction failure/)

    assert.equal(commitOwned, false)
    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.STREAMING)
    assert.equal(harness.step(prepared.assistantStep.id)?.status, AgentStepStatus.RUNNING)
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.RUNNING)
  })

  it('failRun 在一个事务中收口 Message、Step 和 Run', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('failed')
    harness.addPendingStep(prepared.run.id)
    harness.run(prepared.run.id)!.assistantMessageId = null

    await harness.recorder.failRun(
      prepared.run.id,
      '安全错误',
      TEST_DEADLINE,
      {
        id: prepared.message.id,
        conversationId: prepared.run.conversationId,
        content: '部分回答',
      },
    )

    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.FAILED)
    assert.equal(harness.message(prepared.message.id)?.content, '部分回答')
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.FAILED)
    assert.equal(harness.run(prepared.run.id)?.assistantMessageId, prepared.message.id)
    assert.equal(harness.unfinishedSteps(prepared.run.id).length, 0)
    for (const step of harness.steps(prepared.run.id)) {
      assert.equal(step.status, AgentStepStatus.FAILED)
      assert.equal(step.errorMessage, '安全错误')
      assert.ok(step.endedAt)
    }
  })

  it('abortRun 在一个事务中收口 Message、Step 和 Run', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('aborted')
    harness.addPendingStep(prepared.run.id)

    await harness.recorder.abortRun(
      prepared.run.id,
      TEST_DEADLINE,
      {
        id: prepared.message.id,
        conversationId: prepared.run.conversationId,
        content: '已停止',
      },
      {
        id: prepared.assistantStep.id,
        errorMessage: '采样已中止',
        output: {
          usage: {
            inputTokens: 7,
            reasoningTokens: 2,
          },
        },
      },
    )

    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.ABORTED)
    assert.equal(harness.message(prepared.message.id)?.content, '已停止')
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.ABORTED)
    assert.deepEqual(harness.step(prepared.assistantStep.id)?.output, {
      usage: {
        inputTokens: 7,
        reasoningTokens: 2,
      },
    })
    assert.equal(harness.unfinishedSteps(prepared.run.id).length, 0)
    for (const step of harness.steps(prepared.run.id)) {
      assert.equal(step.status, AgentStepStatus.ABORTED)
      assert.ok(step.endedAt)
    }
  })

  it('调用方未取得 Message 结果时仍按 Run 关联收口 late Message', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('late-message-result')

    await harness.recorder.failRun(
      prepared.run.id,
      '安全错误',
      TEST_DEADLINE,
    )

    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.FAILED)
    assert.equal(harness.message(prepared.message.id)?.content, '安全错误')
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.FAILED)
    assert.equal(harness.unfinishedSteps(prepared.run.id).length, 0)
  })

  it('failedStep 迟到完成时保留既有终态并继续收口 Run', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('late-completed-step')
    const completedStep = await harness.recorder.startStep({
      runId: prepared.run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE)
    await harness.recorder.completeStep(completedStep.id, TEST_DEADLINE)

    await harness.recorder.failRun(
      prepared.run.id,
      'Run deadline',
      TEST_DEADLINE,
      {
        id: prepared.message.id,
        conversationId: prepared.run.conversationId,
        content: '部分回答',
      },
      {
        id: completedStep.id,
        errorMessage: '迟到 failure detail',
      },
    )

    assert.equal(harness.step(completedStep.id)?.status, AgentStepStatus.COMPLETED)
    assert.equal(harness.step(completedStep.id)?.errorMessage, null)
    assert.equal(harness.step(prepared.assistantStep.id)?.status, AgentStepStatus.FAILED)
    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.FAILED)
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.FAILED)
    assert.equal(harness.unfinishedSteps(prepared.run.id).length, 0)
  })

  it('terminalization 自身失败时整笔回滚且不伪造已收口', async () => {
    const harness = createHarness()
    const prepared = await harness.prepareAssistantRun('cleanup-failure')
    harness.addPendingStep(prepared.run.id)

    harness.failNextTransactionAt(5)
    await assert.rejects(() => harness.recorder.failRun(
      prepared.run.id,
      '安全错误',
      TEST_DEADLINE,
      {
        id: prepared.message.id,
        conversationId: prepared.run.conversationId,
        content: '部分回答',
      },
    ), /injected transaction failure/)

    assert.equal(harness.message(prepared.message.id)?.status, MessageStatus.STREAMING)
    assert.equal(harness.run(prepared.run.id)?.status, AgentRunStatus.RUNNING)
    assert.equal(harness.unfinishedSteps(prepared.run.id).length, 2)
  })

  it('terminal Run 不能被迟到更新覆盖', async () => {
    const harness = createHarness()
    const completed = await harness.prepareAssistantRun('terminal-completed')
    const completionInput = {
      ...completed.completion,
      content: '已完成',
    }
    await harness.recorder.completeRun(completionInput, TEST_DEADLINE)

    await assertRecorderInvariant(() => harness.recorder.completeRun(
      completionInput,
      TEST_DEADLINE,
    ))
    await assertRecorderInvariant(() => harness.recorder.failRun(
      completed.run.id,
      '迟到失败',
      TEST_DEADLINE,
    ))
    await assertRecorderInvariant(() => harness.recorder.abortRun(
      completed.run.id,
      TEST_DEADLINE,
    ))
    await assertRecorderInvariant(() => harness.recorder.createAssistantMessage(
      completed.run.id,
      completed.run.conversationId,
      TEST_DEADLINE,
    ))
    await assertRecorderInvariant(() => harness.recorder.startStep({
      runId: completed.run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }, TEST_DEADLINE))
    assert.equal(harness.run(completed.run.id)?.status, AgentRunStatus.COMPLETED)

    const abortedRun = await harness.createRun('run-aborted')
    const activeStep = await harness.recorder.startStep({
      runId: abortedRun.id,
      type: AGENT_STEP_TYPES.toolExecution,
    }, TEST_DEADLINE)
    await harness.recorder.abortRun(abortedRun.id, TEST_DEADLINE)
    await assertRecorderInvariant(() => harness.recorder.completeStep(
      activeStep.id,
      TEST_DEADLINE,
    ))
    assert.equal(harness.step(activeStep.id)?.status, AgentStepStatus.ABORTED)
  })

  it('sequence 在同一 Run 内从 1 开始、单调且唯一', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')
    const steps = []

    for (const type of [
      AGENT_STEP_TYPES.receiveUserMessage,
      AGENT_STEP_TYPES.loadConversationHistory,
      AGENT_STEP_TYPES.modelSampling,
    ]) {
      steps.push(await harness.recorder.startStep({ runId: run.id, type }, TEST_DEADLINE))
    }

    assert.deepEqual(steps.map(step => step.sequence), [1, 2, 3])
    assert.equal(new Set(steps.map(step => step.sequence)).size, 3)
  })

  it('不同 Run 可以分别从 sequence 1 开始', async () => {
    const harness = createHarness()
    const firstRun = await harness.createRun('run-a')
    const secondRun = await harness.createRun('run-b')

    const firstStep = await harness.recorder.startStep({
      runId: firstRun.id,
      type: AGENT_STEP_TYPES.receiveUserMessage,
    }, TEST_DEADLINE)
    const secondStep = await harness.recorder.startStep({
      runId: secondRun.id,
      type: AGENT_STEP_TYPES.receiveUserMessage,
    }, TEST_DEADLINE)

    assert.equal(firstStep.sequence, 1)
    assert.equal(secondStep.sequence, 1)
  })
})

async function assertRecorderInvariant(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, error => (
    error instanceof Error
    && error.name === 'RecorderInvariantError'
  ))
}

const UNFINISHED_STEP_STATUSES: AgentStepStatus[] = [
  AgentStepStatus.PENDING,
  AgentStepStatus.RUNNING,
]

function createHarness() {
  const prisma = new FakePrismaService()
  const recorder = new AgentRunRecorderService(
    prisma as unknown as PrismaService,
  )
  const createRun = async (suffix: string) => {
    const conversationId = `conversation-${suffix}`

    prisma.ensureConversation(conversationId)
    return await recorder.createRun({
      conversationId,
      userMessageId: `message-${suffix}`,
    })
  }

  return {
    recorder,
    createRun,
    prepareAssistantRun: async (suffix: string) => {
      const run = await createRun(suffix)
      const message = await recorder.createAssistantMessage(
        run.id,
        run.conversationId,
        TEST_DEADLINE,
      )
      const assistantStep = await recorder.startStep({
        runId: run.id,
        type: AGENT_STEP_TYPES.assistantOutput,
      }, TEST_DEADLINE)

      return {
        run,
        message,
        assistantStep,
        completion: {
          runId: run.id,
          conversationId: run.conversationId,
          assistantMessageId: message.id,
          assistantOutputStepId: assistantStep.id,
        },
      }
    },
    run: (runId: string) => prisma.runs.find(run => run.id === runId),
    message: (messageId: string) => prisma.messages.find(message => message.id === messageId),
    step: (stepId: string) => prisma.steps.find(step => step.id === stepId),
    steps: (runId: string) => prisma.steps.filter(step => step.runId === runId),
    unfinishedSteps: (runId: string) => prisma.steps.filter(step => (
      step.runId === runId
      && UNFINISHED_STEP_STATUSES.includes(step.status)
    )),
    addPendingStep: (runId: string) => prisma.addPendingStep(runId),
    failNextTransactionAt: (statement: number) => prisma.failNextTransactionAt(statement),
  }
}

interface StoredConversation {
  id: string
  title: string
  updatedAt: Date
}

interface StoredRun {
  id: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string | null
  status: AgentRunStatus
  startedAt: Date
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface StoredStep {
  id: string
  runId: string
  sequence: number
  type: string
  title: string
  status: AgentStepStatus
  input: unknown
  output: unknown
  errorMessage: string | null
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

class FakePrismaService {
  readonly conversations: StoredConversation[] = []
  readonly messages: Message[] = []
  readonly runs: StoredRun[] = []
  readonly steps: StoredStep[] = []

  private nextMessageId = 1
  private nextRunId = 1
  private nextStepId = 1
  private transactionFailureAt: number | undefined

  readonly conversation = {
    update: async ({
      where,
      data,
    }: {
      where: { id: string }
      data: { updatedAt: Date }
    }): Promise<StoredConversation> => {
      const conversation = this.conversations.find(candidate => candidate.id === where.id)

      if (!conversation)
        throw new Error(`conversation ${where.id} not found`)

      conversation.updatedAt = data.updatedAt
      return structuredClone(conversation)
    },
  }

  readonly message = {
    create: async ({ data }: {
      data: Pick<Message, 'conversationId' | 'role' | 'content' | 'status'>
    }): Promise<Message> => {
      const now = new Date()
      const message: Message = {
        id: `assistant-${this.nextMessageId++}`,
        ...data,
        createdAt: now,
        updatedAt: now,
      }

      this.messages.push(message)
      return structuredClone(message)
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }): Promise<Message> => {
      const message = this.messages.find(candidate => candidate.id === where.id)

      if (!message)
        throw new Error(`message ${where.id} not found`)

      return structuredClone(message)
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: MessageWhere
      data: Partial<Pick<Message, 'content' | 'status'>>
    }): Promise<{ count: number }> => {
      const matches = this.messages.filter(message => matchesMessage(message, where))

      for (const message of matches)
        Object.assign(message, structuredClone(data), { updatedAt: new Date() })

      return { count: matches.length }
    },
  }

  readonly agentRun = {
    create: async ({ data }: { data: Partial<StoredRun> }): Promise<StoredRun> => {
      const now = new Date()
      const run: StoredRun = {
        id: `run-${this.nextRunId++}`,
        conversationId: requireString(data.conversationId),
        userMessageId: requireString(data.userMessageId),
        assistantMessageId: data.assistantMessageId ?? null,
        status: data.status ?? AgentRunStatus.RUNNING,
        startedAt: data.startedAt ?? now,
        endedAt: data.endedAt ?? null,
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      }

      this.runs.push(run)
      return structuredClone(run)
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Partial<Pick<StoredRun, 'id' | 'status'>>
      data: Partial<StoredRun>
    }): Promise<{ count: number }> => {
      const matches = this.runs.filter(run => (
        (where.id === undefined || run.id === where.id)
        && (where.status === undefined || run.status === where.status)
      ))

      for (const run of matches)
        Object.assign(run, structuredClone(data), { updatedAt: new Date() })

      return { count: matches.length }
    },
  }

  readonly agentStep = {
    aggregate: async ({ where }: { where: { runId: string } }) => ({
      _max: {
        sequence: this.steps
          .filter(step => step.runId === where.runId)
          .reduce<number | null>((maximum, step) => (
            maximum === null ? step.sequence : Math.max(maximum, step.sequence)
          ), null),
      },
    }),
    count: async ({ where }: { where: StepWhere }): Promise<number> => (
      this.steps.filter(step => matchesStep(step, where)).length
    ),
    create: async ({ data }: { data: Partial<StoredStep> }): Promise<StoredStep> => {
      const runId = requireString(data.runId)
      const sequence = requireNumber(data.sequence)

      if (this.steps.some(step => step.runId === runId && step.sequence === sequence))
        throw new Error(`duplicate sequence ${runId}:${sequence}`)

      const now = new Date()
      const step: StoredStep = {
        id: `step-${this.nextStepId++}`,
        runId,
        sequence,
        type: requireString(data.type),
        title: requireString(data.title),
        status: data.status ?? AgentStepStatus.PENDING,
        input: data.input ?? null,
        output: data.output ?? null,
        errorMessage: data.errorMessage ?? null,
        startedAt: data.startedAt ?? null,
        endedAt: data.endedAt ?? null,
        createdAt: data.createdAt ?? now,
        updatedAt: data.updatedAt ?? now,
      }

      this.steps.push(step)
      return structuredClone(step)
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const step = this.steps.find(candidate => candidate.id === where.id)
      return step ? structuredClone(step) : null
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: StepWhere
      data: Partial<StoredStep>
    }): Promise<{ count: number }> => {
      const matches = this.steps.filter(step => matchesStep(step, where))

      for (const step of matches)
        Object.assign(step, structuredClone(data), { updatedAt: new Date() })

      return { count: matches.length }
    },
  }

  async $queryRaw<T>(
    _query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> {
    const runId = requireString(values[0])
    const run = this.runs.find(candidate => candidate.id === runId)

    return (run
      ? [{
          id: run.id,
          status: run.status,
          conversationId: run.conversationId,
          assistantMessageId: run.assistantMessageId,
        }]
      : []) as T
  }

  async withDeadlineTransaction<T>(
    deadline: DatabaseOperationDeadline,
    operation: (transaction: DeadlineTransaction) => Promise<T>,
    onCommitOwned?: () => void,
  ): Promise<T> {
    const snapshot = this.snapshot()
    const failureAt = this.transactionFailureAt

    this.transactionFailureAt = undefined

    try {
      this.assertDeadline(deadline)
      const result = await operation(new FakeDeadlineTransaction(this, failureAt))

      this.assertDeadline(deadline)
      onCommitOwned?.()
      return result
    }
    catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  ensureConversation(id: string): void {
    if (this.conversations.some(conversation => conversation.id === id))
      return

    this.conversations.push({
      id,
      title: id,
      updatedAt: new Date(),
    })
  }

  failNextTransactionAt(statement: number): void {
    this.transactionFailureAt = statement
  }

  addPendingStep(runId: string): void {
    const existingSequences = this.steps
      .filter(step => step.runId === runId)
      .map(step => step.sequence)
    const sequence = Math.max(0, ...existingSequences) + 1
    const now = new Date()

    this.steps.push({
      id: `step-${this.nextStepId++}`,
      runId,
      sequence,
      type: 'legacy_pending',
      title: '历史待执行步骤',
      status: AgentStepStatus.PENDING,
      input: null,
      output: null,
      errorMessage: null,
      startedAt: null,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  private assertDeadline(deadline: DatabaseOperationDeadline): void {
    deadline.signal?.throwIfAborted()

    if (Date.now() >= deadline.deadlineAt)
      throw deadline.createTimeoutError()
  }

  private snapshot() {
    return {
      conversations: structuredClone(this.conversations),
      messages: structuredClone(this.messages),
      runs: structuredClone(this.runs),
      steps: structuredClone(this.steps),
      nextMessageId: this.nextMessageId,
      nextRunId: this.nextRunId,
      nextStepId: this.nextStepId,
    }
  }

  private restore(snapshot: ReturnType<FakePrismaService['snapshot']>): void {
    this.conversations.splice(0, this.conversations.length, ...snapshot.conversations)
    this.messages.splice(0, this.messages.length, ...snapshot.messages)
    this.runs.splice(0, this.runs.length, ...snapshot.runs)
    this.steps.splice(0, this.steps.length, ...snapshot.steps)
    this.nextMessageId = snapshot.nextMessageId
    this.nextRunId = snapshot.nextRunId
    this.nextStepId = snapshot.nextStepId
  }
}

class FakeDeadlineTransaction implements DeadlineTransaction {
  private statement = 0

  constructor(
    private readonly prisma: FakePrismaService,
    private readonly failureAt: number | undefined,
  ) {}

  async execute<T>(
    operation: (prisma: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    this.statement += 1

    if (this.statement === this.failureAt)
      throw new Error('injected transaction failure')

    return await operation(this.prisma as unknown as Prisma.TransactionClient)
  }
}

interface StepWhere {
  id?: string
  runId?: string
  type?: string
  status?: AgentStepStatus | { in: AgentStepStatus[] }
}

interface MessageWhere {
  id?: string
  conversationId?: string
  role?: MessageRole
  status?: MessageStatus | { in: MessageStatus[] }
}

function matchesStep(step: StoredStep, where: StepWhere): boolean {
  if (where.id !== undefined && step.id !== where.id)
    return false
  if (where.runId !== undefined && step.runId !== where.runId)
    return false
  if (where.type !== undefined && step.type !== where.type)
    return false
  if (where.status === undefined)
    return true
  if (typeof where.status === 'object')
    return where.status.in.includes(step.status)

  return step.status === where.status
}

function matchesMessage(message: Message, where: MessageWhere): boolean {
  if (where.id !== undefined && message.id !== where.id)
    return false
  if (where.conversationId !== undefined && message.conversationId !== where.conversationId)
    return false
  if (where.role !== undefined && message.role !== where.role)
    return false
  if (where.status === undefined)
    return true
  if (typeof where.status === 'object')
    return where.status.in.includes(message.status)

  return message.status === where.status
}

function requireString(value: unknown): string {
  if (typeof value !== 'string')
    throw new TypeError('expected string')

  return value
}

function requireNumber(value: unknown): number {
  if (typeof value !== 'number')
    throw new TypeError('expected number')

  return value
}
