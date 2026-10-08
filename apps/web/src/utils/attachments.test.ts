import assert from 'node:assert/strict'
import { ATTACHMENT_MAX_COUNT, ATTACHMENT_FILE_MAX_BYTES as FILE_MAX_BYTES, ATTACHMENT_IMAGE_MAX_BYTES as IMAGE_MAX_BYTES } from '@agent/contracts'
import { it } from 'vitest'

import {
  attachmentKind,
  attachmentPreviewMode,
  decodeText,
  fitImageSize,
  formatFileSize,
  parseCsv,
  splitFileName,
  validateAttachments,
} from './attachments'

it('按扩展名分图片与文件，不认识的类型不收', () => {
  assert.equal(attachmentKind('截图.PNG'), 'image')
  assert.equal(attachmentKind('报表.v2.xlsx'), 'file')
  assert.equal(attachmentKind('照片.heic'), undefined)
  assert.equal(attachmentKind('README'), undefined)
})

it('每种支持的类型都有自己的预览方式', () => {
  assert.equal(attachmentPreviewMode('a.jpg'), 'image')
  assert.equal(attachmentPreviewMode('a.md'), 'markdown')
  assert.equal(attachmentPreviewMode('a.csv'), 'table')
  assert.equal(attachmentPreviewMode('a.json'), 'text')
  assert.equal(attachmentPreviewMode('a.pdf'), 'pdf')
  assert.equal(attachmentPreviewMode('a.docx'), 'docx')
  assert.equal(attachmentPreviewMode('a.xlsx'), 'sheet')
  assert.equal(attachmentPreviewMode('a.heic'), undefined)
})

it('文件名拆成主名与扩展名，点开头的文件名没有扩展名', () => {
  assert.deepEqual(splitFileName('9月流量.final.xlsx'), ['9月流量.final', '.xlsx'])
  assert.deepEqual(splitFileName('.gitignore'), ['.gitignore', ''])
})

it('类型、大小、重复、数量依次校验，放得进的照收', () => {
  const existing = Array.from({ length: ATTACHMENT_MAX_COUNT - 1 }, (_, index) => ({ name: `${index}.md`, bytes: 1 }))
  const result = validateAttachments(existing, [
    { name: 'a.heic', size: 1 },
    { name: 'big.png', size: IMAGE_MAX_BYTES + 1 },
    { name: '0.md', size: 1 },
    { name: 'big.pdf', size: FILE_MAX_BYTES },
    { name: 'extra.md', size: 1 },
  ])

  assert.deepEqual(result.accepted, [3])
  assert.deepEqual(result.rejected.map(item => item.reason), ['unsupported', 'tooLarge', 'duplicate', 'tooMany'])
})

it('同名同大小算重复，同一批里的也算；同名不同大小照收', () => {
  const result = validateAttachments([{ name: 'a.png', bytes: 10 }], [
    { name: 'a.png', size: 10 },
    { name: 'a.png', size: 11 },
    { name: 'b.png', size: 5 },
    { name: 'b.png', size: 5 },
  ])

  assert.deepEqual(result.accepted, [1, 2])
  assert.deepEqual(result.rejected.map(item => item.reason), ['duplicate', 'duplicate'])
})

it('文件大小按 B / KB / MB 显示', () => {
  assert.equal(formatFileSize(512), '512 B')
  assert.equal(formatFileSize(1536), '1.5 KB')
  assert.equal(formatFileSize(1024 * 1024 * 2.5), '2.5 MB')
})

it('图片等比缩进 320，不放大，长图短边保底 120', () => {
  assert.deepEqual(fitImageSize(1920, 1080), { width: 320, height: 180 })
  assert.deepEqual(fitImageSize(40, 40), { width: 40, height: 40 })
  assert.deepEqual(fitImageSize(400, 4000), { width: 120, height: 320 })
})

it('CSV 按行列拆开，引号里的逗号、换行和转义引号留在同一格', () => {
  assert.deepEqual(parseCsv('日期,备注\r\n09-01,"涨了, 很多"\n09-02,"他说 ""好""\n第二行"\n\n'), [
    ['日期', '备注'],
    ['09-01', '涨了, 很多'],
    ['09-02', '他说 "好"\n第二行'],
  ])
})

it('文本先按 UTF-8 解，解不开按 GB18030', () => {
  assert.equal(decodeText(new TextEncoder().encode('日期').buffer as ArrayBuffer), '日期')
  assert.equal(decodeText(new Uint8Array([0xC8, 0xD5, 0xC6, 0xDA]).buffer), '日期')
})
