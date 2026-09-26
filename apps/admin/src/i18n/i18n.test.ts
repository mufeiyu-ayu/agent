import assert from 'node:assert/strict'
import dayjs from 'dayjs'
import { describe, it } from 'vitest'

import { i18n, resolveAdminLocale } from './index'
import { messages } from './messages'

describe('admin i18n', () => {
  it('语言解析：存储值优先，其次按浏览器语言回落', () => {
    assert.equal(resolveAdminLocale('en-US', 'zh-CN'), 'en-US')
    assert.equal(resolveAdminLocale(null, 'en-GB'), 'en-US')
    assert.equal(resolveAdminLocale('unknown', 'zh-CN'), 'zh-CN')
    assert.equal(dayjs('2026-08-10').locale('zh-cn').format('ddd'), '周一')
  })

  it('中英键集合一致', () => {
    assert.deepEqual(getKeys(messages['zh-CN']), getKeys(messages['en-US']))
  })

  it('切换语言后按当前语言取文案', () => {
    i18n.global.locale.value = 'en-US'
    assert.equal(i18n.global.t('navigation.runs'), 'Runs')
    i18n.global.locale.value = 'zh-CN'
    assert.equal(i18n.global.t('navigation.runs'), '运行记录')
  })
})

function getKeys(value: object, prefix = ''): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof child === 'object' && child !== null ? getKeys(child, path) : path
    })
    .sort()
}
