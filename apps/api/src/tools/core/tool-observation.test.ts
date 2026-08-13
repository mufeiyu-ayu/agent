import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  normalizeToolObservation,
  TOOL_OBSERVATION_HARD_MAX_CHARS,
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
      articles: ['😀'.repeat(16_000), 'tail'],
    })
    const first = normalizeToolObservation(content, 16_000)
    const second = normalizeToolObservation(content, 16_000)

    assert.deepEqual(first, second)
    assert.equal(first.truncated, true)
    assert.equal(first.originalChars, [...content].length)
    assert.equal(first.observationChars, [...first.content].length)
    assert.equal(
      [...(first.previewContent ?? '')].length,
      16_000 - [...first.content.replace(first.previewContent ?? '', '')].length,
    )
    assert.ok(first.observationChars <= 16_000)
    assert.match(first.content, /^\[工具 Observation 已截断/)
    assert.match(first.content, /\[预览结束\]$/)
    assert.equal(hasUnpairedSurrogate(first.content), false)
    assert.throws(() => JSON.parse(first.content))
  })

  it('允许 Search 和 Detail 使用不同预算', () => {
    const content = '文'.repeat(70_000)
    const search = normalizeToolObservation(content, 16_000)
    const detail = normalizeToolObservation(content, 64_000)

    assert.equal(search.observationChars, 16_000)
    assert.equal(detail.observationChars, 64_000)
    assert.equal(search.originalChars, 70_000)
    assert.equal(detail.originalChars, 70_000)
    assert.equal(search.truncated, true)
    assert.equal(detail.truncated, true)
    assert.doesNotMatch(search.previewContent ?? '', /Observation 已截断/)
    assert.doesNotMatch(detail.previewContent ?? '', /Observation 已截断/)
  })

  it('工具声明超过全局硬上限时仍不超过 128K', () => {
    const content = '🚀'.repeat(TOOL_OBSERVATION_HARD_MAX_CHARS + 1)
    const observation = normalizeToolObservation(content, 256_000)

    assert.equal(observation.originalChars, TOOL_OBSERVATION_HARD_MAX_CHARS + 1)
    assert.equal(observation.observationChars, TOOL_OBSERVATION_HARD_MAX_CHARS)
    assert.equal(observation.truncated, true)
    assert.equal(hasUnpairedSurrogate(observation.content), false)
  })

  it('拒绝非法工具级预算', () => {
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => normalizeToolObservation('content', limit),
        /Observation/,
      )
    }
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
