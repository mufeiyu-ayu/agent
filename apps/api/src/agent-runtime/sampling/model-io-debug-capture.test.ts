import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS,
  toModelIODebugCaptureEnvelope,
  toModelIODebugResponseCaptureEnvelope,
} from './model-io-debug-capture.js'

describe('toModelIODebugCaptureEnvelope', () => {
  it('正常值返回未截断信封，并经 JSON round-trip 清理', () => {
    const envelope = toModelIODebugCaptureEnvelope({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: '你好' }],
      dropped: undefined,
    })

    assert.deepEqual(envelope, {
      truncated: false,
      value: {
        model: 'deepseek-v4-flash',
        messages: [{ role: 'user', content: '你好' }],
      },
    })
  })

  it('超过上限时截断为前缀预览字符串', () => {
    const envelope = toModelIODebugCaptureEnvelope({
      content: 'x'.repeat(MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS + 1),
    })

    assert.ok(envelope)
    assert.equal(envelope.truncated, true)

    if (envelope.truncated) {
      assert.equal(
        envelope.preview.length,
        MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS,
      )
      assert.ok(envelope.preview.startsWith('{"content":"xxx'))
    }
  })

  it('截断点落在代理对中间时去掉孤立高位代理', () => {
    // 让 JSON 序列化后第 MAX-1 / MAX 位恰好是一个 emoji 的两个 code unit。
    const envelope = toModelIODebugCaptureEnvelope({
      content: `${'x'.repeat(MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS - 13)}😀`,
    })

    assert.ok(envelope)
    assert.equal(envelope.truncated, true)

    if (envelope.truncated) {
      assert.equal(
        envelope.preview.length,
        MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS - 1,
      )
      assert.ok(envelope.preview.endsWith('x'))
    }
  })

  it('循环引用等不可序列化值降级为 undefined', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    assert.equal(toModelIODebugCaptureEnvelope(circular), undefined)
    assert.equal(toModelIODebugCaptureEnvelope(undefined), undefined)
  })

  it('递归移除 reasoning_content，避免安全 Admin projection 或 DOM 泄漏', () => {
    const envelope = toModelIODebugCaptureEnvelope({
      choices: [{
        message: {
          content: '安全回答',
          reasoning_content: 'DO_NOT_LEAK',
        },
      }],
    })

    assert.deepEqual(envelope, {
      truncated: false,
      value: {
        choices: [{ message: { content: '安全回答' } }],
      },
    })
    assert.doesNotMatch(JSON.stringify(envelope), /DO_NOT_LEAK|reasoning_content/)
  })
})

describe('toModelIODebugResponseCaptureEnvelope', () => {
  it('保留 complete / partial 状态并沿用响应截断信封', () => {
    assert.deepEqual(toModelIODebugResponseCaptureEnvelope({
      state: 'partial',
      lastEvent: 'text_delta',
      textChars: 2,
      toolCallCount: 0,
      rawResponse: { choices: [{ message: { content: '部分' } }] },
    }), {
      state: 'partial',
      truncated: false,
      value: { choices: [{ message: { content: '部分' } }] },
    })
  })

  it('empty 只记录事实，不伪造 value / preview', () => {
    assert.deepEqual(toModelIODebugResponseCaptureEnvelope({
      state: 'empty',
      lastEvent: null,
      textChars: 0,
      toolCallCount: 0,
    }), {
      state: 'empty',
    })
  })

  it('partial 超限时状态保留在截断信封外层', () => {
    const envelope = toModelIODebugResponseCaptureEnvelope({
      state: 'partial',
      lastEvent: 'text_delta',
      textChars: MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS + 1,
      toolCallCount: 0,
      rawResponse: {
        content: 'x'.repeat(MODEL_IO_DEBUG_CAPTURE_MAX_JSON_CHARS + 1),
      },
    })

    assert.ok(envelope)
    assert.equal(envelope.state, 'partial')
    assert.equal('truncated' in envelope ? envelope.truncated : null, true)
  })

  it('响应序列化失败继续安全降级', () => {
    const circular: Record<string, unknown> = {}

    circular.self = circular
    assert.equal(toModelIODebugResponseCaptureEnvelope({
      state: 'partial',
      lastEvent: 'text_delta',
      textChars: 1,
      toolCallCount: 0,
      rawResponse: circular,
    }), undefined)
  })
})
