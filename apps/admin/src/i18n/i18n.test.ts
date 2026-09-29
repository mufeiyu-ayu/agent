import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import { describe, it } from 'vitest'

import { i18n } from './index'

describe('admin i18n', () => {
  it('只有中文文案，日期组件按中文显示', () => {
    assert.equal(i18n.global.t('navigation.runs'), '运行记录')
    assert.deepEqual(i18n.global.availableLocales, ['zh-CN'])
    assert.equal(dayjs('2026-08-10').locale('zh-cn').format('ddd'), '周一')
  })
})
