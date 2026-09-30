import type { ModelInputItem, ModelToolSpec } from '@agent/ai'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { estimateItemTokens, estimateRequestTokens, roughTokens } from './token-estimate.js'

describe('roughTokens（#220 AC-01）', () => {
  it('按 UTF-8 字节数 ÷ 4 向上取整：英文、中文、emoji、中英混排', () => {
    assert.equal(roughTokens(''), 0)
    assert.equal(roughTokens('abcd'), 1)
    assert.equal(roughTokens('abcde'), 2)
    // 一个汉字 3 字节。
    assert.equal(roughTokens('中文'), 2)
    assert.equal(roughTokens('上下文压缩'), 4)
    // emoji 是 4 字节的代理对，不按 JS 长度 2 算。
    assert.equal(roughTokens('😀'), 1)
    assert.equal(roughTokens('😀😀x'), 3)
    assert.equal(roughTokens('Hello 世界'), 3)
  })
})

describe('estimateRequestTokens', () => {
  const tools: ModelToolSpec[] = [{
    name: 'web_search',
    description: '查网页。',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
  }]

  it('每项取发给模型的文字各自取整再求和，工具定义按 JSON 计入', () => {
    const items: ModelInputItem[] = [
      { type: 'message', role: 'system', content: '系统' },
      { type: 'message', role: 'user', content: '问题?' },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-1-不计入', name: 'web_search', rawArgumentsJson: '{"query":"x"}' }],
        reasoningContent: '想想',
        content: '先查',
      },
      { type: 'tool_result', callId: 'call-1-不计入', name: 'web_search', content: '结果', ok: true },
    ]

    // 工具调用项：正文 + 思考 + 工具名 + 参数，callId 不计。
    assert.equal(estimateItemTokens(items[2]!), roughTokens('先查想想web_search{"query":"x"}'))
    assert.equal(
      estimateRequestTokens({ items, tools }),
      roughTokens(JSON.stringify(tools)) + 2 + 2 + roughTokens('先查想想web_search{"query":"x"}') + 2,
    )
  })
})
