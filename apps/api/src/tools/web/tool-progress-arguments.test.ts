import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { toToolProgressArguments } from './tool-progress-arguments.js'

describe('toToolProgressArguments', () => {
  it('#208 AC-05 展示参数：非法 JSON、非对象、非字符串都省略，超长按上限截断，不抛异常', () => {
    assert.deepEqual(toToolProgressArguments('{"query":"seo","url":"https://a.example/"}'), { query: 'seo', url: 'https://a.example/' })
    for (const raw of ['', '{"query":', 'null', '[]', '"seo"', '1', '{"query":1,"url":{"href":"x"}}', '{"q":"seo"}'])
      assert.deepEqual(toToolProgressArguments(raw), {}, raw)
    assert.deepEqual(toToolProgressArguments(JSON.stringify({ query: 'q'.repeat(300), url: `https://a.example/${'u'.repeat(3000)}` })), {
      query: 'q'.repeat(200),
      url: `https://a.example/${'u'.repeat(3000)}`.slice(0, 2048),
    })
  })
})
