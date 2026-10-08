import assert from 'node:assert/strict'
import { it } from 'vitest'

import { formatSheetCell } from './attachment-documents'

it('表格单元格：空值为空串，数字去掉浮点尾巴，日期没有时刻就只显示日期', () => {
  assert.equal(formatSheetCell(null), '')
  assert.equal(formatSheetCell(0.1 + 0.2), '0.3')
  assert.equal(formatSheetCell(1203), '1203')
  assert.equal(formatSheetCell(true), 'true')
  assert.equal(formatSheetCell(new Date(Date.UTC(2026, 8, 1))), new Date(Date.UTC(2026, 8, 1)).toLocaleDateString(undefined, { timeZone: 'UTC' }))
  assert.match(formatSheetCell(new Date(Date.UTC(2026, 8, 1, 9, 30))), /9.30|09.30/)
})
