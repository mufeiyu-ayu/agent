import assert from 'node:assert/strict'
import { it } from 'vitest'
import { messages } from '../i18n/messages'
import { pluginText } from './plugin-text'

it('内置默认文案按语言显示，不改写源数据', () => {
  for (const [id, defaults] of Object.entries(messages['zh-CN'].plugins.builtins)) {
    const plugin = { id, ...defaults }
    for (const field of ['name', 'description'] as const) {
      assert.equal(pluginText(plugin, field, 'zh-CN'), defaults[field])
      assert.doesNotMatch(pluginText(plugin, field, 'en-US'), /[\u4E00-\u9FFF]/u)
      assert.equal(plugin[field], defaults[field])
    }
  }
  assert.equal(pluginText({ id: 'google-developer-knowledge', name: 'Google 开发文档' }, 'name', 'en-US'), 'Google Developer Knowledge')
})

it('管理员自定义字段、私人同名插件和空简介保留原文', () => {
  const plugin = { id: 'google-developer-knowledge', name: '运营文档', description: '团队自己的简介' }
  assert.equal(pluginText(plugin, 'name', 'en-US'), '运营文档')
  assert.equal(pluginText(plugin, 'description', 'en-US'), '团队自己的简介')
  assert.equal(pluginText({ id: 'private-google', name: 'Google 开发文档' }, 'name', 'en-US'), 'Google 开发文档')
  assert.equal(pluginText({ id: 'github', name: 'GitHub', description: '' }, 'description', 'en-US'), '')
})
