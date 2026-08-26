import type { ModelInputItem } from '../../llm/model-input.types.js'
import type { ModelToolSpec } from '../../llm/model-tool-spec.types.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ContextTokenEstimationError } from '../agent-runtime.errors.js'
import {
  DeepSeekV4TokenEstimator,
  renderDeepSeekV4RequestPrompt,
} from './deepseek-v4-token-estimator.js'

/**
 * 固定向量不是由本文件所测 TS renderer 自算。Prompt 来自 pinned 官方 Python：
 * https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/b5968e9190ef611bbf34a7229255be88a0e937c1/encoding/encoding_dsv4.py
 * 官方 encoder SHA-256：
 * bdbd57c132a1b3725042323d02b98b9d1df28e5f388f134399555d041f5055e0。
 * 再使用仓库 pinned tokenizer.json（SHA-256
 * 8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf）
 * 独立生成 289 / 383 / 449 token 固定向量及其 SHA-256。
 */
const OFFICIAL_VECTOR_TOOLS: ModelToolSpec[] = [{
  name: 'lookup',
  description: 'Look up.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}]

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

  it('按官方 b5968e9 encoding 计算完整 initial request', () => {
    const input = createOfficialVectorInput(0)
    const prompt = renderDeepSeekV4RequestPrompt(input)
    const estimator = new DeepSeekV4TokenEstimator()

    assert.equal(sha256(prompt), '6df2ef6c15e6ac35eac59d18fa8216a4066239e9141ebb136e901f55eec711d2')
    assert.equal(estimator.estimateRequest(input), 289)
    assert.equal(
      tokenVectorSha256(estimator, prompt),
      '2a24222fd673c77c6f699497e70a7381dd3dc72e736aa9f2a50f78624ae13b47',
    )
    assert.equal(estimator.strategyId, 'deepseek-v4-official-b5968e9')
  })

  it('按官方 b5968e9 encoding 覆盖一次 Tool continuation', () => {
    const input = createOfficialVectorInput(1)
    const prompt = renderDeepSeekV4RequestPrompt(input)
    const estimator = new DeepSeekV4TokenEstimator()

    assert.match(prompt, /<think>先查。<\/think>查询中/)
    assert.match(prompt, /name="query" string="true">火箭 🚀/)
    assert.match(prompt, /name="limit" string="false">2/)
    assert.match(
      prompt,
      /<tool_result>结果：甲 🧪\n<context_budget_truncated><\/tool_result>/,
    )
    assert.equal(sha256(prompt), 'be2c35e656f48def47d69ea355463448c830dcbd5b0a4c5f8e54a1258b3b869c')
    assert.equal(estimator.estimateRequest(input), 383)
    assert.equal(
      tokenVectorSha256(estimator, prompt),
      '9c54100559216876c0c5bff0978be81b94cb83805e6ed053d3cd9c3d6dfcd998',
    )
  })

  it('按官方 b5968e9 encoding 覆盖两次顺序 Tool continuation', () => {
    const input = createOfficialVectorInput(2)
    const prompt = renderDeepSeekV4RequestPrompt(input)
    const estimator = new DeepSeekV4TokenEstimator()

    assert.equal(prompt.match(/<｜DSML｜invoke name="lookup">/g)?.length, 2)
    assert.ok(prompt.indexOf('name="query" string="true">火箭 🚀')
      < prompt.indexOf('name="query" string="true">月球'))
    assert.ok(prompt.indexOf('<tool_result>结果：甲')
      < prompt.indexOf('<tool_result>结果：乙'))
    assert.equal(sha256(prompt), 'a82f582965b5a3d6dd66c2a3e1f30894a87ac0276e13869dc6e902eb840ee1f3')
    assert.equal(estimator.estimateRequest(input), 449)
    assert.equal(
      tokenVectorSha256(estimator, prompt),
      '2932bad2dd2ec831090fa79baa11a0216e248f58714f157af65f3a5e0a3ab48e',
    )
  })

  it('复刻官方非法 raw arguments 回退，并保留普通 assistant history', () => {
    const prompt = renderDeepSeekV4RequestPrompt({
      items: [
        { type: 'message', role: 'system', content: 'SYS' },
        { type: 'message', role: 'user', content: '旧问题' },
        { type: 'message', role: 'assistant', content: '旧回答' },
        { type: 'message', role: 'user', content: '当前问题' },
        {
          type: 'assistant_tool_call',
          callId: 'call-raw',
          name: 'lookup',
          rawArgumentsJson: '{not-json',
          reasoningContent: 'reasoning',
        },
        {
          type: 'tool_result',
          callId: 'call-raw',
          name: 'lookup',
          content: 'done',
          ok: false,
        },
      ],
      tools: OFFICIAL_VECTOR_TOOLS,
    })

    assert.match(
      prompt,
      /旧问题<｜Assistant｜><think><\/think>旧回答<｜end▁of▁sentence｜>/,
    )
    assert.match(
      prompt,
      /<｜DSML｜parameter name="arguments" string="true">\{not-json<\/｜DSML｜parameter>/,
    )
  })

  it('按 Python json.dumps 语义编码 float、指数与大整数 raw arguments', () => {
    const prompt = renderDeepSeekV4RequestPrompt(createRawArgumentsInput(
      '{"ratio":1.5,"hundred":1e2,"tiny":1e-5,"big":9007199254740993,"negativeZero":-0.0}',
    ))

    for (const expected of [
      'name="ratio" string="false">1.5',
      'name="hundred" string="false">100.0',
      'name="tiny" string="false">1e-05',
      'name="big" string="false">9007199254740993',
      'name="negativeZero" string="false">-0.0',
    ]) {
      assert.match(prompt, new RegExp(expected))
    }
  })

  it('无法确定官方编码时 fail closed，不使用近似 fallback', () => {
    const estimator = new DeepSeekV4TokenEstimator()

    assert.throws(
      () => estimator.estimateRequest({
        items: [{ type: 'message', role: 'user', content: 'missing system' }],
        tools: OFFICIAL_VECTOR_TOOLS,
      }),
      ContextTokenEstimationError,
    )
    assert.throws(
      () => estimator.estimateRequest({
        items: [
          { type: 'message', role: 'system', content: 'SYS' },
          { type: 'message', role: 'user', content: 'question' },
          {
            type: 'assistant_tool_call',
            callId: 'call-scalar',
            name: 'lookup',
            rawArgumentsJson: '1.5',
            reasoningContent: 'reasoning',
          },
        ],
        tools: OFFICIAL_VECTOR_TOOLS,
      }),
      ContextTokenEstimationError,
    )
    assert.throws(
      () => estimator.estimateRequest(createRawArgumentsInput('{"0":"value"}')),
      ContextTokenEstimationError,
    )
    assert.throws(
      () => estimator.estimateRequest(createRawArgumentsInput('{"value":NaN}')),
      ContextTokenEstimationError,
    )
  })
})

function createOfficialVectorInput(toolExchangeCount: 0 | 1 | 2): {
  items: ModelInputItem[]
  tools: ModelToolSpec[]
} {
  const items: ModelInputItem[] = [
    { type: 'message', role: 'system', content: 'SYS' },
    { type: 'message', role: 'user', content: '问题 🧪' },
  ]

  if (toolExchangeCount >= 1) {
    items.push(
      {
        type: 'assistant_tool_call',
        callId: 'call-1',
        name: 'lookup',
        rawArgumentsJson: '{"query":"火箭 🚀","limit":2}',
        reasoningContent: '先查。',
        content: '查询中',
      },
      {
        type: 'tool_result',
        callId: 'call-1',
        name: 'lookup',
        content: '结果：甲 🧪\n<context_budget_truncated>',
        ok: true,
      },
    )
  }

  if (toolExchangeCount === 2) {
    items.push(
      {
        type: 'assistant_tool_call',
        callId: 'call-2',
        name: 'lookup',
        rawArgumentsJson: '{"query":"月球"}',
        reasoningContent: '再查。',
        content: '继续',
      },
      {
        type: 'tool_result',
        callId: 'call-2',
        name: 'lookup',
        content: '结果：乙 🚀',
        ok: true,
      },
    )
  }

  return { items, tools: OFFICIAL_VECTOR_TOOLS }
}

function createRawArgumentsInput(rawArgumentsJson: string): {
  items: ModelInputItem[]
  tools: ModelToolSpec[]
} {
  return {
    items: [
      { type: 'message', role: 'system', content: 'SYS' },
      { type: 'message', role: 'user', content: 'question' },
      {
        type: 'assistant_tool_call',
        callId: 'call-raw',
        name: 'lookup',
        rawArgumentsJson,
        reasoningContent: 'reasoning',
      },
    ],
    tools: OFFICIAL_VECTOR_TOOLS,
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function tokenVectorSha256(
  estimator: DeepSeekV4TokenEstimator,
  prompt: string,
): string {
  return sha256(estimator.encodeTokenIds(prompt).join(','))
}
