import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { isPreviewableHtml } from './html-preview'

describe('完整 HTML 文档的预览入口', () => {
  it('兼容大小写、DOCTYPE 和文档注释；其他语言、片段、未收完的文档不开放', () => {
    assert.equal(isPreviewableHtml('<html><body>页面</body></html>', 'HTML'), true)
    assert.equal(isPreviewableHtml('<!-- 注释 -->\n<!DOCTYPE html>\n<html lang="zh-CN"><body>页面</body></html>\n<!-- 结束 -->', 'html'), true)
    for (const language of ['ts', 'typescript', 'js', 'javascript', 'jsx', 'tsx', undefined])
      assert.equal(isPreviewableHtml('<html><body>字符串</body></html>', language), false)
    assert.equal(isPreviewableHtml('<h1>片段</h1>', 'html'), false)
    assert.equal(isPreviewableHtml('<html><body>尚未结束', 'html'), false)
    assert.equal(isPreviewableHtml('const page = "<html></html>"', 'html'), false)
  })
})
