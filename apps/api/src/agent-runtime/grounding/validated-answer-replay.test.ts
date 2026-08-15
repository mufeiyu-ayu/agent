import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为重放切分引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  toValidatedAnswerChunks,
  VALIDATED_ANSWER_REPLAY_CHUNK_CODE_POINTS,
} from './validated-answer-replay.js'

const UNICODE_ANSWER = '你好🌍👨‍👩‍👧‍👦 SEO 标题 é 𝕊𝔼𝕆 结尾。'

describe('toValidatedAnswerChunks', () => {
  it('chunks 拼接后逐字符等于原文', () => {
    for (const answer of [
      'a',
      '短回答。',
      UNICODE_ANSWER,
      UNICODE_ANSWER.repeat(20),
      '🌍'.repeat(VALIDATED_ANSWER_REPLAY_CHUNK_CODE_POINTS * 3 + 1),
    ]) {
      assert.equal(toValidatedAnswerChunks(answer).join(''), answer)
    }
  })

  it('不会把代理对或 Emoji 从中间拆开', () => {
    const chunks = toValidatedAnswerChunks('🌍'.repeat(10), 3)

    assert.deepEqual(chunks, ['🌍🌍🌍', '🌍🌍🌍', '🌍🌍🌍', '🌍'])
    for (const chunk of chunks) {
      // 出现落单代理码元就说明切分越过了 code point 边界。
      assert.doesNotMatch(chunk, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
      assert.doesNotMatch(chunk, /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    }
  })

  it('切分确定且只受 chunk 大小影响', () => {
    assert.deepEqual(
      toValidatedAnswerChunks(UNICODE_ANSWER),
      toValidatedAnswerChunks(UNICODE_ANSWER),
    )
    assert.deepEqual(toValidatedAnswerChunks('abcdef', 2), ['ab', 'cd', 'ef'])
    assert.deepEqual(toValidatedAnswerChunks('abcde', 2), ['ab', 'cd', 'e'])
  })

  it('空回答不产生任何 delta', () => {
    assert.deepEqual(toValidatedAnswerChunks(''), [])
  })

  it('非法 chunk 大小直接抛错，不静默退化', () => {
    assert.throws(() => toValidatedAnswerChunks('abc', 0), RangeError)
    assert.throws(() => toValidatedAnswerChunks('abc', -1), RangeError)
    assert.throws(() => toValidatedAnswerChunks('abc', 1.5), RangeError)
  })
})
