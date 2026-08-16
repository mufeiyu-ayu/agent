import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为终态契约引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  GROUNDED_ANSWER_ARGUMENTS_MAX_CHARS,
  GROUNDED_ANSWER_MAX_CHARS,
  GroundedAnswerRejectedError,
  parseSubmitGroundedAnswerInput,
  submitGroundedAnswerToolSpec,
} from './grounded-answer.contract.js'

function assertRejected(rawArgumentsJson: string, code: string): void {
  assert.throws(
    () => parseSubmitGroundedAnswerInput(rawArgumentsJson),
    (error: unknown) => {
      assert.ok(error instanceof GroundedAnswerRejectedError)
      assert.equal(error.code, code)
      return true
    },
  )
}

describe('submitGroundedAnswerToolSpec', () => {
  it('只暴露模型可见字段，且禁止额外属性', () => {
    assert.deepEqual(Object.keys(submitGroundedAnswerToolSpec).sort(), [
      'description',
      'inputSchema',
      'name',
    ])
    assert.equal(submitGroundedAnswerToolSpec.name, 'submit_grounded_answer')
    assert.equal(submitGroundedAnswerToolSpec.inputSchema.additionalProperties, false)
    assert.deepEqual(
      submitGroundedAnswerToolSpec.inputSchema.required.sort(),
      ['answer', 'citationKeys', 'outcome'],
    )
    assert.deepEqual(
      submitGroundedAnswerToolSpec.inputSchema.properties.citationKeys,
      {
        type: 'array',
        items: { type: 'string' },
        description: submitGroundedAnswerToolSpec.inputSchema.properties.citationKeys?.description,
      },
    )
  })
})

describe('parseSubmitGroundedAnswerInput', () => {
  it('接受合法终态输出', () => {
    const input = parseSubmitGroundedAnswerInput(JSON.stringify({
      answer: '基于站内资料的回答。',
      outcome: 'answered',
      citationKeys: ['evk_1', 'evk_2'],
    }))

    assert.deepEqual(input, {
      answer: '基于站内资料的回答。',
      outcome: 'answered',
      citationKeys: ['evk_1', 'evk_2'],
    })
  })

  it('允许空 citationKeys', () => {
    const input = parseSubmitGroundedAnswerInput(JSON.stringify({
      answer: '当前资料无法确认。',
      outcome: 'insufficient_evidence',
      citationKeys: [],
    }))

    assert.deepEqual(input.citationKeys, [])
  })

  it('非法 JSON 返回 malformed_json', () => {
    assertRejected('{not json', 'malformed_json')
  })

  it('缺字段或多字段返回 schema_invalid', () => {
    assertRejected(
      JSON.stringify({ answer: 'a', outcome: 'answered' }),
      'schema_invalid',
    )
    assertRejected(
      JSON.stringify({
        answer: 'a',
        outcome: 'answered',
        citationKeys: [],
        evidenceAvailability: 'available',
      }),
      'schema_invalid',
    )
  })

  it('模型不能提交 evidenceAvailability 覆盖服务端判定', () => {
    assertRejected(
      JSON.stringify({
        answer: 'a',
        outcome: 'answered',
        citationKeys: [],
        availability: 'available',
      }),
      'schema_invalid',
    )
  })

  it('未知 outcome 返回 schema_invalid', () => {
    assertRejected(
      JSON.stringify({ answer: 'a', outcome: 'maybe', citationKeys: [] }),
      'schema_invalid',
    )
  })

  it('空白 answer 返回 answer_empty', () => {
    assertRejected(
      JSON.stringify({ answer: '   \n', outcome: 'answered', citationKeys: [] }),
      'answer_empty',
    )
  })

  it('超长 answer 返回 answer_too_long', () => {
    assertRejected(
      JSON.stringify({
        answer: '字'.repeat(GROUNDED_ANSWER_MAX_CHARS + 1),
        outcome: 'answered',
        citationKeys: [],
      }),
      'answer_too_long',
    )
  })

  it('超体积 arguments 在解析前就被拒绝', () => {
    assertRejected(
      `"${'x'.repeat(GROUNDED_ANSWER_ARGUMENTS_MAX_CHARS)}"`,
      'arguments_too_large',
    )
  })

  it('citationKeys 数量或元素类型非法时 fail closed', () => {
    assertRejected(
      JSON.stringify({
        answer: 'a',
        outcome: 'answered',
        citationKeys: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
      'citation_keys_too_many',
    )
    assertRejected(
      JSON.stringify({ answer: 'a', outcome: 'answered', citationKeys: [301] }),
      'citation_key_invalid',
    )
    assertRejected(
      JSON.stringify({ answer: 'a', outcome: 'answered', citationKeys: [''] }),
      'citation_key_invalid',
    )
    assertRejected(
      JSON.stringify({ answer: 'a', outcome: 'answered', citationKeys: 'evk_1' }),
      'schema_invalid',
    )
  })
})
