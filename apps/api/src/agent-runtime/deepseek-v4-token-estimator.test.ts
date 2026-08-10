import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  DeepSeekV4TokenEstimator,
  renderDeepSeekV4InitialPrompt,
} from './deepseek-v4-token-estimator.js'

describe('DeepSeekV4TokenEstimator', () => {
  it('与 DeepSeek V4 官方 tokenizer 的跨语言固定向量一致', () => {
    const estimator = new DeepSeekV4TokenEstimator()

    assert.deepEqual(
      [
        'Hello, DeepSeek V4.',
        '你好，世界。',
        'Codex 🧪🚀',
        '<｜begin▁of▁sentence｜>SYS<｜User｜>问题<｜Assistant｜><think>',
      ].map(text => estimator.encodeTokenIds(text)),
      [
        [19923, 14, 22651, 4374, 1465, 721, 22, 16],
        [30594, 303, 3427, 320],
        [9945, 90, 7351, 103, 106, 74287, 225],
        [0, 53, 20842, 128803, 2056, 128804, 128821],
      ],
    )
  })

  it('按官方 V4 chat/tool encoding 计算完整初始请求', () => {
    const input = {
      messages: [
        { role: 'system' as const, content: 'SYS' },
        { role: 'user' as const, content: '问题' },
      ],
      tools: [{
        name: 'search',
        description: 'Search docs.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string' as const, description: 'Keywords.' },
          },
          required: ['query'],
          additionalProperties: false as const,
        },
      }],
    }
    const prompt = renderDeepSeekV4InitialPrompt(input)
    const estimator = new DeepSeekV4TokenEstimator()

    assert.match(prompt, /^<｜begin▁of▁sentence｜>SYS\n\n## Tools/)
    assert.match(prompt, /"additionalProperties": false/)
    assert.match(prompt, /<｜User｜>问题<｜Assistant｜><think>$/)
    assert.equal(estimator.estimateInitialRequest(input), 282)
    assert.equal(estimator.strategyId, 'deepseek-v4-official-b5968e9')
    assert.ok(estimator.estimateInitialRequest(input) > estimator.estimateInitialRequest({
      messages: input.messages,
      tools: [],
    }))
  })
})
