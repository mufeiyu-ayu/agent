import assert from 'node:assert/strict'
import { it } from 'vitest'

import { formatMessageTime } from './time-format'

const now = new Date(2026, 8, 25, 16, 30)

it('今天只显示时刻，昨天带相对日，更早带日期，跨年带年份，无效时间为空', () => {
  assert.equal(formatMessageTime(new Date(2026, 8, 25, 9, 5), 'zh-CN', now), '09:05')
  assert.equal(formatMessageTime(new Date(2026, 8, 24, 23, 59), 'zh-CN', now), '昨天 23:59')
  assert.equal(formatMessageTime(new Date(2026, 8, 24, 23, 59), 'en-US', now), 'yesterday 23:59')
  assert.match(formatMessageTime(new Date(2026, 8, 20, 14, 32), 'zh-CN', now), /^9月20日 14:32$/)
  assert.match(formatMessageTime(new Date(2025, 11, 31, 8, 0), 'zh-CN', now), /2025/)
  assert.equal(formatMessageTime(new Date(''), 'zh-CN', now), '')
})
