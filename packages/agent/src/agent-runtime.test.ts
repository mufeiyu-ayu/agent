import type { ModelInputItem } from '@agent/ai'
import type { RunTurnStreamInput } from './agent-runtime.types.js'
import type { JsonObject, RuntimeHost, StoredMessage } from './host.js'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { familyCompatOf } from '@agent/contracts'
import { it } from 'vitest'
import { AgentRuntime } from './agent-runtime.js'
import { ContextCompactionService } from './context/context-compaction.service.js'
import { normalizeToolObservation } from './tools/tool-observation.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

for (const abortAfterCommit of [false, true]) {
  it(`无 Nest/数据库的完整循环：提交屏障阻止成功事件和续轮，确认后取消=${abortAfterCommit}`, async () => {
    const gate = deferred()
    const entered = deferred()
    const controller = new AbortController()
    const requests: ModelInputItem[][] = []
    const steps: Array<{ type: string, output?: JsonObject }> = []
    const terminal: string[] = []
    let confirmed = false
    let released = 0
    const message = (id: string, content = ''): StoredMessage => ({ id, content, createdAt: new Date(), updatedAt: new Date() })
    const services: Omit<RuntimeHost, 'compaction'> = {
      logger: { warn: () => {}, error: () => {} },
      aiErrorMessage: error => error.message,
      classifyError: () => undefined,
      createTimeoutError: () => new Error('test deadline'),
      assertConversationExists: async () => {},
      createUserMessage: async (_id, content) => message('user', content),
      loadHistory: async () => ({ history: { readAt: new Date(), compaction: undefined, groups: [] }, messageCount: 0 }),
      recorder: {
        createRun: async () => ({ id: 'run' }),
        createAssistantMessage: async () => message('assistant'),
        startStep: async (input) => {
          steps.push({ type: input.type })
          return { id: String(steps.length - 1) }
        },
        completeStep: async (id, _deadline, close) => { Object.assign(steps[Number(id)]!, close) },
        failStep: async () => { assert.fail('本例没有失败 Step') },
        completeRun: async (input, _deadline, ownCommit) => {
          ownCommit()
          terminal.push('completed')
          return message(input.assistantMessageId, input.content)
        },
        abortRun: async () => { terminal.push('aborted') },
        failRun: async () => { assert.fail('本例不应失败') },
      },
      async* stream(items) {
        requests.push(structuredClone(items))
        if (requests.length === 1) {
          yield { type: 'tool_call_completed', toolCall: { index: 0, providerCallId: 'call', name: 'echo', argumentsJson: '{"value":42}' }, reasoningContent: '' }
          yield { type: 'response_completed', finishReason: 'tool_calls' }
        }
        else {
          assert.ok(confirmed)
          yield { type: 'text_delta', delta: '完成' }
          yield { type: 'response_completed', finishReason: 'stop' }
        }
      },
      prepareToolBatch: async () => undefined,
      toolProgress: () => ({}),
      invokeTool: async () => ({
        result: { ok: true, modelContent: '42' },
        argumentsValidated: true,
        observation: normalizeToolObservation('42'),
        finishStep: async (id, deadline, close) => {
          entered.resolve()
          await gate.promise
          confirmed = true
          await services.recorder.completeStep(id, deadline, close)
        },
      }),
      releaseRun: async () => { released += 1 },
    }
    const host: RuntimeHost = {
      ...services,
      compaction: new ContextCompactionService({ ...services, insertCompaction: async () => { throw new Error('无需摘要') } }),
    }
    const input: RunTurnStreamInput = {
      conversationId: 'conversation',
      userContent: '问',
      signal: controller.signal,
      instructions: [],
      tools: [],
      model: { modelId: 'model', providerId: 'provider', family: 'deepseek', maxInputTokens: 100_000, profile: {
        wireName: 'fake',
        contextWindowTokens: 200_000,
        maxOutputTokens: 8_000,
        compat: familyCompatOf('deepseek'),
        reasoningEffort: null,
      } },
      runtimeConfig: { limits: { runDeadlineMs: 5_000 }, compactionKeepRecentTokens: 1_000, debugCaptureModelIo: false },
    }
    const stream = new AgentRuntime(host).runTurnStream(input)
    assert.equal((await stream.next()).value?.type, 'run_started')
    assert.equal((await stream.next()).value?.type, 'tool_started')
    let delivered = false
    const waiting = stream.next().then((event) => {
      delivered = true
      return event
    })
    try {
      await entered.promise
      await sleep(10)
      assert.equal(delivered, false, '提交未确认时不能产出 tool_finished')
      assert.equal(requests.length, 1, '提交未确认时不能继续采样')
      if (abortAfterCommit)
        controller.abort(new Error('user stop'))
      gate.resolve()
      assert.equal((await waiting).value?.type, abortAfterCommit ? 'run_aborted' : 'tool_finished')
      for await (const _ of stream) { /* drain finalization */ }
      assert.deepEqual(terminal, [abortAfterCommit ? 'aborted' : 'completed'])
      assert.equal(requests.length, abortAfterCommit ? 1 : 2)
      assert.equal(steps.find(step => step.type === 'tool_execution')?.output?.observation, '42')
      assert.ok(released >= 1)
      if (!abortAfterCommit)
        assert.ok(requests[1]!.some(item => item.type === 'tool_result' && item.content === '42'))
    }
    finally {
      gate.resolve()
      await waiting
      await stream.return(undefined)
    }
  })
}
