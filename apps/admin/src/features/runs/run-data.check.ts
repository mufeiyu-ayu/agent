import assert from 'node:assert/strict'

import { getMockRunDetail, mockRunList } from './run.mocks'
import {
  computeRunSummary,
  filterRuns,
  formatDuration,
  formatTokens,
  getDefaultTimelineItem,
  paginateRuns,
} from './run.utils'

assert.equal(mockRunList.length, 8)

const summary = computeRunSummary(mockRunList)
assert.deepEqual(summary, {
  totalRuns: 8,
  successRate: 62.5,
  avgDurationMs: 2_773,
  totalTokens: 9_878,
})

assert.equal(filterRuns(mockRunList, {
  query: '多语言',
  status: undefined,
  model: undefined,
  dateFrom: '',
  dateTo: '',
}).length, 1)
assert.equal(filterRuns(mockRunList, {
  query: 'demo_run_tool',
  status: 'COMPLETED',
  model: 'gpt-4o',
  dateFrom: '2026-07-16',
  dateTo: '2026-07-16',
}).length, 1)
assert.equal(filterRuns(mockRunList, {
  query: '',
  status: 'FAILED',
  model: undefined,
  dateFrom: '',
  dateTo: '',
}).length, 1)
assert.equal(filterRuns(mockRunList, {
  query: '',
  status: 'COMPLETED',
  model: undefined,
  dateFrom: '',
  dateTo: '',
}).length, 5)
assert.equal(filterRuns(mockRunList, {
  query: '',
  status: undefined,
  model: 'gpt-4o',
  dateFrom: '',
  dateTo: '',
}).length, 2)
assert.equal(filterRuns(mockRunList, {
  query: '',
  status: undefined,
  model: undefined,
  dateFrom: '2026-07-16',
  dateTo: '2026-07-16',
}).length, 1)

assert.equal(paginateRuns(mockRunList, 1, 5).length, 5)
assert.equal(paginateRuns(mockRunList, 2, 5).length, 3)
assert.equal(formatDuration(2_480), '2.48s')
assert.equal(formatDuration(null), '—')
assert.equal(formatTokens(9_878), '9.88K')
assert.equal(formatTokens(null), '—')

const toolRun = getMockRunDetail('demo_run_tool_20260719_01')
assert.ok(toolRun)
assert.equal(toolRun.toolCallCount, 1)
assert.equal(toolRun.samplingCount, 2)
assert.deepEqual(
  toolRun.timeline
    .filter(item => item.kind === 'durable_step')
    .map(item => item.type),
  [
    'receive_user_message',
    'load_conversation_history',
    'model_sampling',
    'tool_execution',
    'model_sampling',
    'assistant_output',
  ],
)
assert.deepEqual(
  toolRun.timeline
    .filter(item => item.type === 'model_sampling')
    .map(item => item.finishReason),
  ['tool_calls', 'stop'],
)
assert.equal(getDefaultTimelineItem(toolRun.timeline)?.id, `${toolRun.id}:step-3`)
const secondToolSampling = toolRun.timeline.find(item => (
  item.type === 'model_sampling' && item.samplingIndex === 2
))
const toolAssistantOutput = toolRun.timeline.find(item => item.type === 'assistant_output')
assert.ok(secondToolSampling?.endedAt)
assert.ok(toolAssistantOutput)
assert.ok(toolAssistantOutput.endedAt)
assert.ok(new Date(toolAssistantOutput.startedAt) < new Date(secondToolSampling.endedAt))
assert.ok(new Date(toolRun.messages[1]!.updatedAt) <= new Date(toolAssistantOutput.endedAt))
assert.ok(new Date(toolAssistantOutput.endedAt) <= new Date(toolRun.endedAt!))
assert.equal(toolRun.messages.every(message => (
  message.role === 'USER' || message.role === 'ASSISTANT'
)), true)
assert.equal(toolRun.safeRawData.agentSteps.length, 6)
assert.equal(toolRun.safeRawData.agentSteps.some(step => (
  (step.type as string) === 'run_lifecycle'
)), false)
assert.equal(JSON.stringify(toolRun.safeRawData).includes(toolRun.questionPreview), false)
assert.equal(JSON.stringify(toolRun.safeRawData).includes(toolRun.messages[1]?.contentPreview ?? ''), false)

const forbiddenKeys = new Set([
  'authorization',
  'chainOfThought',
  'observation',
  'providerPayload',
  'rawArguments',
  'rawArgumentsJson',
  'secret',
  'stack',
  'systemPrompt',
  'toolResult',
])

assertNoForbiddenKeys(toolRun.safeRawData)

const ordinaryRun = getMockRunDetail('demo_run_answer_20260719_02')
assert.ok(ordinaryRun)
assert.deepEqual(
  ordinaryRun.timeline
    .filter(item => item.kind === 'durable_step')
    .map(item => item.type),
  [
    'receive_user_message',
    'load_conversation_history',
    'model_sampling',
    'assistant_output',
  ],
)
const ordinarySampling = ordinaryRun.timeline.find(item => item.type === 'model_sampling')
const ordinaryAssistantOutput = ordinaryRun.timeline.find(item => item.type === 'assistant_output')
assert.ok(ordinarySampling?.endedAt)
assert.ok(ordinaryAssistantOutput)
assert.ok(ordinaryAssistantOutput.endedAt)
assert.ok(new Date(ordinaryAssistantOutput.startedAt) < new Date(ordinarySampling.endedAt))
assert.ok(new Date(ordinaryRun.messages[1]!.createdAt) < new Date(ordinaryRun.messages[1]!.updatedAt))
assert.ok(new Date(ordinaryRun.messages[1]!.updatedAt) <= new Date(ordinaryAssistantOutput.endedAt))
assert.ok(new Date(ordinaryAssistantOutput.endedAt) <= new Date(ordinaryRun.endedAt!))

for (const run of mockRunList) {
  if (run.endedAt === null) {
    assert.equal(run.durationMs, null)
    continue
  }

  assert.equal(
    new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime(),
    run.durationMs,
  )
}

const runningRun = getMockRunDetail('demo_run_running_20260719_05')
assert.ok(runningRun)
assert.equal(runningRun.endedAt, null)
assert.equal(runningRun.durationMs, null)
assert.equal(runningRun.timeline.at(-1)?.status, 'RUNNING')
const runningAssistantOutput = runningRun.timeline.find(item => item.type === 'assistant_output')
assert.ok(runningAssistantOutput)
assert.equal(runningAssistantOutput.status, 'RUNNING')
assert.equal(runningAssistantOutput.endedAt, null)
assert.equal(runningAssistantOutput.durationMs, null)
assert.equal(runningAssistantOutput.contentLength, null)

const abortedRun = getMockRunDetail('demo_run_aborted_20260718_04')
assert.ok(abortedRun)
const abortedAssistantOutput = abortedRun.timeline.find(item => item.type === 'assistant_output')
assert.ok(abortedAssistantOutput)
assert.equal(abortedAssistantOutput.status, 'ABORTED')
assert.equal(abortedAssistantOutput.endedAt, abortedRun.endedAt)
assert.equal(abortedAssistantOutput.contentLength, null)
assert.ok(new Date(abortedRun.messages[1]!.updatedAt) <= new Date(abortedAssistantOutput.endedAt!))

const failedRun = getMockRunDetail('demo_run_failed_20260719_03')
assert.ok(failedRun)
const failedSampling = failedRun.timeline.find(item => item.type === 'model_sampling')
assert.ok(failedSampling?.endedAt)
assert.ok(new Date(failedSampling.endedAt) <= new Date(failedRun.messages[1]!.updatedAt))
assert.ok(new Date(failedRun.messages[1]!.updatedAt) <= new Date(failedRun.endedAt!))

console.log('admin run data checks passed')

function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenKeys)
    return
  }

  if (!value || typeof value !== 'object')
    return

  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenKeys.has(key), false, `Safe Raw Data 出现禁止字段：${key}`)
    assertNoForbiddenKeys(child)
  }
}
