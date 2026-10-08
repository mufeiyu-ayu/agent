import assert from 'node:assert/strict'
import { it } from 'vitest'

import { questionItem } from './conversation-history.js'
import { estimateItemTokens, IMAGE_TOKENS, roughTokens } from './token-estimate.js'
import { userMessageContent } from './user-attachments.js'

it('附件在前、用户的字在后：文档带正文，图片只留空标签，文件名里的引号和尖括号换掉', () => {
  assert.equal(
    userMessageContent('帮我看看', [{ name: '报表.xlsx', text: '日期,访问量\n9/1,1203' }, { name: '首页.png' }]),
    '<file name="报表.xlsx">\n日期,访问量\n9/1,1203\n</file>\n<file name="首页.png"></file>\n帮我看看',
  )
  assert.equal(userMessageContent('', [{ name: 'a"><b.md', text: 'x' }]), '<file name="a___b.md">\nx\n</file>\n')
  // 没有附件时就是用户打的字，和之前逐字相同。
  assert.equal(userMessageContent('你好', []), '你好')
})

it('问题带图片才有 images 键；每张图片固定按 1200 token 估', () => {
  const createdAt = new Date(0)
  const image = { name: 'a.png', mimeType: 'image/png', data: 'AAAA' }

  assert.deepEqual(questionItem({ content: '你好', createdAt }), { type: 'message', role: 'user', content: '你好' })
  assert.deepEqual(questionItem({ content: '你好', images: [], createdAt }), { type: 'message', role: 'user', content: '你好' })

  const item = questionItem({ content: '看图', images: [image, image], createdAt })
  assert.deepEqual(item.images, [image, image])
  assert.equal(estimateItemTokens(item), roughTokens('看图') + 2 * IMAGE_TOKENS)
})
