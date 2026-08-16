import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { messages } from './messages'

/**
 * 超出 v1 contract 的表述。
 *
 * `citationIntegrity=validated` 只证明引用身份属于本次 Run 的真实证据，
 * `faithfulnessStatus=not_evaluated` 表示尚未做逐断言语义核验，
 * 因此任何「已核验 / 可信度 / 事实核查通过」的说法都是过度承诺。
 */
const OVERCLAIMING_PHRASES = [
  '已验证',
  '已核实',
  '已核验',
  '事实核验',
  '事实核查',
  '可信度',
  '置信度',
  '准确无误',
  'verified',
  'fact-check',
  'fact check',
  'confidence',
  'trustworthy',
  'guaranteed',
  'proven',
]

function collectKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null)
    return [prefix]

  return Object.entries(value).flatMap(([key, child]) => {
    return collectKeys(child, prefix ? `${prefix}.${key}` : key)
  })
}

function collectValues(value: unknown): string[] {
  if (typeof value === 'string')
    return [value]

  if (typeof value !== 'object' || value === null)
    return []

  return Object.values(value).flatMap(collectValues)
}

describe('i18n 文案完整性', () => {
  it('zh-CN 与 en-US 的 key 集合完全一致', () => {
    assert.deepEqual(
      collectKeys(messages['zh-CN']).sort(),
      collectKeys(messages['en-US']).sort(),
    )
  })

  it('两种语言都覆盖全部 Grounding 状态、来源与粒度文案', () => {
    const requiredKeys = [
      'conversation.grounding.status.answered',
      'conversation.grounding.status.conflicting',
      'conversation.grounding.status.insufficientWithEvidence',
      'conversation.grounding.status.insufficientNone',
      'conversation.grounding.status.insufficientUnavailable',
      'conversation.grounding.note.partial',
      'conversation.grounding.sources.answered',
      'conversation.grounding.sources.checked',
      'conversation.grounding.sources.conflicting',
      'conversation.grounding.granularity.article',
      'conversation.grounding.granularity.chunk',
    ]

    for (const locale of ['zh-CN', 'en-US'] as const) {
      const localeKeys = new Set(collectKeys(messages[locale]))

      for (const key of requiredKeys) {
        assert.ok(localeKeys.has(key), `${locale} 缺少 ${key}`)
      }
    }
  })

  it('Grounding 文案不对外宣称答案已经过事实核验', () => {
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const groundingTexts = collectValues(messages[locale].conversation.grounding)

      for (const text of groundingTexts) {
        for (const phrase of OVERCLAIMING_PHRASES) {
          assert.ok(
            !text.toLowerCase().includes(phrase.toLowerCase()),
            `${locale} 文案「${text}」不应包含过度承诺表述「${phrase}」`,
          )
        }
      }
    }
  })
})
