import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { messages } from './messages'

function collectKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null)
    return [prefix]

  return Object.entries(value).flatMap(([key, child]) => {
    return collectKeys(child, prefix ? `${prefix}.${key}` : key)
  })
}

describe('i18n 文案完整性', () => {
  it('zh-CN 与 en-US 的 key 集合完全一致', () => {
    assert.deepEqual(
      collectKeys(messages['zh-CN']).sort(),
      collectKeys(messages['en-US']).sort(),
    )
  })
})
