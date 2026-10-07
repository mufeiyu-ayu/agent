import type { LLMService } from '../llm/llm.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { WorkspaceCommit } from '../workspaces/workspace-files.js'
import type { ContextCompactionService } from './context/context-compaction.service.js'
import type { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'
import assert from 'node:assert/strict'
import { claimRunTermination, createRunCancellation, normalizeToolObservation } from '@agent/agent'
import { it } from 'vitest'
import { WORKSPACE_TOOL_NAMES } from '../chat/prompts/workspace-development.prompt.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { DatabaseOperationDeadlineExceededError } from '../prisma/prisma.service.js'
import { createRuntimeConfigSnapshot } from '../runtime-config/__fixtures__.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { createRuntimeHost } from './agent-runtime-host.js'

it('核心产生的 deadline 工厂经真实 invoke 仍抛原 DB 超时类，归因为 deadline 而不是工具失败', async () => {
  let original: Error | undefined
  const registry = new ToolRegistryService()
  registry.register({
    definition: { name: 'probe', version: '1', description: 'probe', input: { schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, parse: value => value }, timeoutMs: 10_000, maxObservationChars: 100 },
    executor: { execute: async (_input, context) => {
      original = context.databaseDeadline.createTimeoutError()
      throw original
    } },
  })
  const host = createHost(new ToolInvocationService(registry))
  const cancellation = createRunCancellation(undefined, 1_000, host.createTimeoutError)
  try {
    await assert.rejects(host.invokeTool({ callId: 'call', toolName: 'probe', rawArgumentsJson: '{}' }, {
      runId: 'run',
      conversationId: 'conversation',
      signal: cancellation.signal,
      databaseDeadline: cancellation.databaseDeadline,
      argumentsTruncated: false,
    }), (error: unknown) => {
      assert.ok(error instanceof DatabaseOperationDeadlineExceededError)
      assert.equal(error, original)
      claimRunTermination(cancellation, error, host.classifyError)
      assert.equal(cancellation.source, 'deadline')
      return true
    })
  }
  finally {
    cancellation.dispose()
  }
})

it('并发宿主指南状态各自独立，发布对象只由本次 finishStep 闭包交给 Recorder', async () => {
  const commits: unknown[] = []
  const flags: boolean[] = []
  let guideId = 0
  const commit = { marker: 'only-in-host' } as unknown as WorkspaceCommit
  const recorder = {
    startStep: async () => ({ id: `guide-${++guideId}` }),
    completeStep: async (_id: string, _deadline: unknown, close: { workspaceCommit?: WorkspaceCommit }) => { commits.push(close.workspaceCommit) },
  } as unknown as AgentRunRecorderService
  const tools = {
    invoke: async (_call: unknown, context: { workspaceGuideRequired: boolean }) => {
      flags.push(context.workspaceGuideRequired)
      return { result: { ok: true, modelContent: 'saved', workspaceCommit: commit }, argumentsValidated: true, observation: normalizeToolObservation('saved') }
    },
  } as unknown as ToolInvocationService
  const a = createHost(tools, recorder)
  const b = createHost(tools, recorder)
  const deadline = { deadlineAt: Date.now() + 1_000, createTimeoutError: a.createTimeoutError }
  const call = { callId: 'call', toolName: WORKSPACE_TOOL_NAMES[0]!, rawArgumentsJson: '{}' }
  const batch = { runId: 'a', samplingAttemptId: 'sample', calls: [call], argumentsTruncated: false }
  assert.ok(await a.prepareToolBatch(batch, deadline))
  const context = { runId: 'a', conversationId: 'conversation', signal: new AbortController().signal, databaseDeadline: deadline, argumentsTruncated: false }
  await b.invokeTool(call, { ...context, runId: 'b' })
  const invocation = await a.invokeTool(call, context)
  assert.deepEqual(flags, [false, true])
  assert.equal(Object.hasOwn(invocation.result, 'workspaceCommit'), false)
  assert.equal(commits.includes(commit), false)
  await invocation.finishStep('step', deadline, { output: { ok: true } })
  assert.equal(commits.at(-1), commit)
  assert.equal(await a.prepareToolBatch(batch, deadline), undefined)
  assert.ok(await b.prepareToolBatch({ ...batch, runId: 'b' }, deadline))
})

function createHost(tools: ToolInvocationService, recorder = {} as AgentRunRecorderService) {
  return createRuntimeHost({ conversationId: 'conversation', userContent: 'question', model: createResolvedLlmModel(), runtimeConfig: createRuntimeConfigSnapshot(), instructions: [] }, {
    llm: {} as LLMService,
    prisma: {} as PrismaService,
    recorder,
    tools,
    compaction: {} as ContextCompactionService,
    logger: { warn: () => {}, error: () => {} },
  })
}
