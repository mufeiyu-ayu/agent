import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Recorder 引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { AgentRunStatus, AgentStepStatus } from '../generated/prisma/client.js'
import {
  AGENT_STEP_TYPES,
  AgentRunRecorderService,
} from './agent-run-recorder.service.js'

describe('AgentRunRecorderService', () => {
  it('同一 Run 可以创建两条独立 model_sampling', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')

    const first = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    })
    const second = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    })

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
    })
    const second = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    })

    await harness.recorder.completeStep(first.id, {
      output: { finishReason: 'tool_calls' },
    })

    assert.equal(harness.step(first.id)?.status, AgentStepStatus.COMPLETED)
    assert.equal(harness.step(second.id)?.status, AgentStepStatus.RUNNING)

    await harness.recorder.completeStep(second.id, {
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
    })
    const failed = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.toolExecution,
    })
    const aborted = await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.assistantOutput,
    })

    await harness.recorder.completeStep(completed.id)
    await harness.recorder.failStep(failed.id, { errorMessage: '安全失败' })
    await harness.recorder.abortStep(aborted.id)

    await assertRecorderInvariant(() => harness.recorder.failStep(completed.id, {
      errorMessage: '迟到失败',
    }))
    await assertRecorderInvariant(() => harness.recorder.abortStep(failed.id))
    await assertRecorderInvariant(() => harness.recorder.completeStep(aborted.id))
  })

  it('completeRun 在仍有 RUNNING Step 时失败', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')
    await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    })

    await assertRecorderInvariant(() => harness.recorder.completeRun(run.id))

    assert.equal(harness.run(run.id)?.status, AgentRunStatus.RUNNING)
    assert.equal(harness.unfinishedSteps(run.id).length, 1)
  })

  it('failRun 在事务中收口所有非终态 Step', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')
    await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    })
    harness.addPendingStep(run.id)

    await harness.recorder.failRun(run.id, '安全错误')

    assert.equal(harness.run(run.id)?.status, AgentRunStatus.FAILED)
    assert.equal(harness.unfinishedSteps(run.id).length, 0)
    for (const step of harness.steps(run.id)) {
      assert.equal(step.status, AgentStepStatus.FAILED)
      assert.equal(step.errorMessage, '安全错误')
      assert.ok(step.endedAt)
    }
  })

  it('abortRun 在事务中收口所有非终态 Step', async () => {
    const harness = createHarness()
    const run = await harness.createRun('run-a')
    await harness.recorder.startStep({
      runId: run.id,
      type: AGENT_STEP_TYPES.modelSampling,
    })
    harness.addPendingStep(run.id)

    await harness.recorder.abortRun(run.id)

    assert.equal(harness.run(run.id)?.status, AgentRunStatus.ABORTED)
    assert.equal(harness.unfinishedSteps(run.id).length, 0)
    for (const step of harness.steps(run.id)) {
      assert.equal(step.status, AgentStepStatus.ABORTED)
      assert.ok(step.endedAt)
    }
  })

  it('terminal Run 不能被迟到更新覆盖', async () => {
    const harness = createHarness()
    const completedRun = await harness.createRun('run-completed')
    await harness.recorder.completeRun(completedRun.id)

    await assertRecorderInvariant(() => harness.recorder.completeRun(completedRun.id))
    await assertRecorderInvariant(() => harness.recorder.failRun(completedRun.id, '迟到失败'))
    await assertRecorderInvariant(() => harness.recorder.abortRun(completedRun.id))
    await assertRecorderInvariant(() => harness.recorder.attachAssistantMessage(
      completedRun.id,
      'assistant-late',
    ))
    await assertRecorderInvariant(() => harness.recorder.startStep({
      runId: completedRun.id,
      type: AGENT_STEP_TYPES.modelSampling,
    }))
    assert.equal(harness.run(completedRun.id)?.status, AgentRunStatus.COMPLETED)

    const abortedRun = await harness.createRun('run-aborted')
    const activeStep = await harness.recorder.startStep({
      runId: abortedRun.id,
      type: AGENT_STEP_TYPES.toolExecution,
    })
    await harness.recorder.abortRun(abortedRun.id)
    await assertRecorderInvariant(() => harness.recorder.completeStep(activeStep.id))
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
      steps.push(await harness.recorder.startStep({ runId: run.id, type }))
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
    })
    const secondStep = await harness.recorder.startStep({
      runId: secondRun.id,
      type: AGENT_STEP_TYPES.receiveUserMessage,
    })

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

  return {
    recorder,
    createRun: async (suffix: string) => await recorder.createRun({
      conversationId: `conversation-${suffix}`,
      userMessageId: `message-${suffix}`,
    }),
    run: (runId: string) => prisma.runs.find(run => run.id === runId),
    step: (stepId: string) => prisma.steps.find(step => step.id === stepId),
    steps: (runId: string) => prisma.steps.filter(step => step.runId === runId),
    unfinishedSteps: (runId: string) => prisma.steps.filter(step => (
      step.runId === runId
      && UNFINISHED_STEP_STATUSES.includes(step.status)
    )),
    addPendingStep: (runId: string) => prisma.addPendingStep(runId),
  }
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
  readonly runs: StoredRun[] = []
  readonly steps: StoredStep[] = []

  private nextRunId = 1
  private nextStepId = 1

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

    return (run ? [{ id: run.id, status: run.status }] : []) as T
  }

  async $transaction<T>(operation: (prisma: FakePrismaService) => Promise<T>): Promise<T> {
    return await operation(this)
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
}

interface StepWhere {
  id?: string
  runId?: string
  status?: AgentStepStatus | { in: AgentStepStatus[] }
}

function matchesStep(step: StoredStep, where: StepWhere): boolean {
  if (where.id !== undefined && step.id !== where.id)
    return false
  if (where.runId !== undefined && step.runId !== where.runId)
    return false
  if (where.status === undefined)
    return true
  if (typeof where.status === 'object')
    return where.status.in.includes(step.status)

  return step.status === where.status
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
