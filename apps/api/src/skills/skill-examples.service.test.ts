import type { ModelStreamEvent } from '@agent/ai'
import type { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import type { LLMService } from '../llm/llm.service.js'
import assert from 'node:assert/strict'
import { validateSkillPackage } from '@agent/skills'
import { afterEach, it, vi } from 'vitest'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { SkillExamplesService } from './skill-examples.service.js'

const pkg = validateSkillPackage([{ path: 'SKILL.md', encoding: 'utf8', content: '---\nname: title-check\ndescription: 检查文章标题\n---\n检查标题的清晰度，不修改事实。' }])
const examples = ['帮我检查这篇文章的标题是否清晰。', '请为这篇文章提供三个更清楚的标题。', '检查这个标题是否准确概括了文章内容。']
afterEach(() => vi.useRealTimers())

it('默认模型生成三个可发送示例，关闭思考且只传技能说明', async () => {
  const resolveModel = vi.fn(async () => createResolvedLlmModel())
  const chatStream = vi.fn(async function* (): AsyncGenerator<ModelStreamEvent> {
    yield { type: 'text_delta', delta: JSON.stringify(examples) }
    yield { type: 'response_completed', finishReason: 'stop' }
  })
  const service = new SkillExamplesService({ resolveModel, listVisibleModels: async () => [{ id: 'model-deepseek-v4-flash', isDefault: true }] } as unknown as LlmModelConfigService, { chatStream } as unknown as LLMService)
  assert.deepEqual(await service.generate(pkg), examples)
  const [provider, messages, options] = (chatStream.mock.calls as unknown as Parameters<LLMService['chatStream']>[])[0]!
  assert.equal(provider.apiKey, 'test-api-key')
  assert.equal(messages.length, 2)
  assert.equal(options.request.thinking, 'disabled')
  assert.ok(JSON.stringify(messages).includes('检查标题的清晰度'))
  assert.ok(!JSON.stringify(messages).includes('test-api-key'))
})

for (const output of ['not-json', JSON.stringify(examples.slice(0, 2)), JSON.stringify([examples[0], examples[0], examples[0]]), JSON.stringify(['bad\u0000text-long-enough', ...examples.slice(1)]), JSON.stringify([42, ...examples.slice(1)])]) {
  it(`拒绝无效示例：${output.slice(0, 25)}`, async () => {
    const service = new SkillExamplesService({ resolveModel: async () => createResolvedLlmModel(), listVisibleModels: async () => [{ id: 'model-deepseek-v4-flash', isDefault: true }] } as unknown as LlmModelConfigService, {
      async* chatStream() {
        yield { type: 'text_delta', delta: output }
        yield { type: 'response_completed', finishReason: 'stop' }
      },
    } as unknown as LLMService)
    await assert.rejects(service.generate(pkg), /示例生成失败/u)
  })
}

it('截断的模型输出不当作成功', async () => {
  const service = new SkillExamplesService({ resolveModel: async () => createResolvedLlmModel(), listVisibleModels: async () => [{ id: 'model-deepseek-v4-flash', isDefault: true }] } as unknown as LlmModelConfigService, {
    async* chatStream() {
      yield { type: 'text_delta', delta: JSON.stringify(examples) }
      yield { type: 'response_completed', finishReason: 'length' }
    },
  } as unknown as LLMService)
  await assert.rejects(service.generate(pkg), /尚未发布/u)
})

it('整次生成超时会取消流，不暴露上游错误详情', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const service = new SkillExamplesService({ resolveModel: async () => createResolvedLlmModel(), listVisibleModels: async () => [{ id: 'model-deepseek-v4-flash', isDefault: true }] } as unknown as LlmModelConfigService, {
    async* chatStream(_provider, _messages, options) {
      signal = options.signal
      await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('private-provider-key')), { once: true }))
      yield { type: 'response_completed', finishReason: 'stop' }
    },
  } as LLMService)
  const pending = assert.rejects(service.generate(pkg), (error: unknown) => error instanceof Error && error.message.includes('尚未发布') && !error.message.includes('private-provider-key'))
  await vi.advanceTimersByTimeAsync(45_000)
  await pending
  assert.equal(signal?.aborted, true)
})

it('未设置默认模型时复用排序最前的可用模型', async () => {
  const resolveModel = vi.fn(async () => createResolvedLlmModel())
  const service = new SkillExamplesService({
    resolveModel,
    listVisibleModels: async () => [{ id: 'first-visible', isDefault: false }, { id: 'second-visible', isDefault: false }],
  } as unknown as LlmModelConfigService, {
    async* chatStream() {
      yield { type: 'text_delta', delta: JSON.stringify(examples) }
      yield { type: 'response_completed', finishReason: 'stop' }
    },
  } as unknown as LLMService)
  assert.deepEqual(await service.generate(pkg), examples)
  assert.deepEqual(resolveModel.mock.calls[0], ['first-visible'])
})
