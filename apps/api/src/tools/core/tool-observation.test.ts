import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  MAX_TOOL_OBSERVATION_CHARS,
  normalizeToolObservation,
} from './tool-observation.js'

describe('normalizeToolObservation', () => {
  it('不改写上限内的 Observation，并按 Unicode code point 计数', () => {
    const content = '文章😀结果'

    assert.deepEqual(normalizeToolObservation(content), {
      content,
      originalChars: 5,
      observationChars: 5,
      truncated: false,
    })
  })

  it('对超限 Observation 生成确定性的文本预览 envelope', () => {
    const content = JSON.stringify({
      articles: ['😀'.repeat(MAX_TOOL_OBSERVATION_CHARS), 'tail'],
    })
    const first = normalizeToolObservation(content)
    const second = normalizeToolObservation(content)

    assert.deepEqual(first, second)
    assert.equal(first.truncated, true)
    assert.equal(first.originalChars, [...content].length)
    assert.equal(first.observationChars, [...first.content].length)
    assert.ok(first.observationChars <= MAX_TOOL_OBSERVATION_CHARS)
    assert.match(first.content, /^\[工具 Observation 已截断/)
    assert.match(first.content, /\[预览结束\]$/)
    assert.equal(hasUnpairedSurrogate(first.content), false)
    assert.throws(() => JSON.parse(first.content))
  })
})

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)

    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)

      if (next < 0xDC00 || next > 0xDFFF)
        return true

      index += 1
    }
    else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true
    }
  }

  return false
}
