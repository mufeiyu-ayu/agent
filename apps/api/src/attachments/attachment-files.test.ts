import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'vitest'

import {
  attachmentKindOf,
  attachmentObjectKey,
  contentTypeOf,
  decodeText,
  DOCUMENT_TEXT_MAX_CHARS,
  matchesFileSignature,
  MODEL_IMAGE_MAX_BYTES,
  modelImageProcesses,
  safeAttachmentName,
  toModelDocumentText,
} from './attachment-files.js'
import { extractDocumentText } from './document-text.js'

const fixture = (name: string) => readFile(new URL(`./__fixtures__/${name}`, import.meta.url))

describe('附件的类型与内容校验', () => {
  it('类型只按扩展名判断，响应的 Content-Type 只从固定表里取', () => {
    assert.equal(attachmentKindOf('截图.PNG'), 'image')
    assert.equal(attachmentKindOf('报表.v2.xlsx'), 'file')
    assert.equal(attachmentKindOf('page.html'), undefined)
    assert.equal(attachmentKindOf('.png'), undefined)
    assert.equal(contentTypeOf('a.md'), 'text/plain; charset=utf-8')
    assert.equal(contentTypeOf('a.html'), 'application/octet-stream')
  })

  it('内容和扩展名对不上的拒绝：改名成图片的 HTML、不是 zip 的 docx', () => {
    assert.equal(matchesFileSignature('a.png', Buffer.from('<html><script>alert(1)</script>')), false)
    assert.equal(matchesFileSignature('a.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])), true)
    assert.equal(matchesFileSignature('a.webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), true)
    assert.equal(matchesFileSignature('a.docx', Buffer.from('not a zip')), false)
    assert.equal(matchesFileSignature('a.pdf', Buffer.from('%PDF-1.4')), true)
    assert.equal(matchesFileSignature('a.md', Buffer.from('随便什么文字')), true)
  })

  it('文件名去掉路径与控制字符', () => {
    assert.equal(safeAttachmentName('../../etc/报表\n.xlsx'), '报表.xlsx')
    assert.equal(safeAttachmentName('C:\\Users\\a\\首页.png'), '首页.png')
  })

  it('对象 key 先按用户分，和工作区的会话前缀分开', () => {
    assert.equal(attachmentObjectKey('user_1', 'att_1', 'original'), 'users/user_1/attachments/att_1/original')
  })
})

describe('给模型的文档文字', () => {
  it('文本先按 UTF-8 解，解不开按 GB18030；含 NUL 的当二进制', () => {
    assert.equal(decodeText(Buffer.from('日期,访问量')), '日期,访问量')
    // 「日期」的 GBK 编码，不是合法 UTF-8。
    assert.equal(decodeText(Buffer.from([0xC8, 0xD5, 0xC6, 0xDA])), '日期')
    assert.equal(decodeText(Buffer.from([0x61, 0x00, 0x62])), undefined)
  })

  it('去掉 BOM；空文档写明没有文字；超出上限截断并说明原长度，不在代理对中间切开', () => {
    assert.equal(toModelDocumentText('\uFEFF 标题\n'), '标题')
    assert.equal(toModelDocumentText('  \n'), '[This file contains no extractable text.]')

    const long = `${'字'.repeat(DOCUMENT_TEXT_MAX_CHARS - 1)}😀尾巴`
    const text = toModelDocumentText(long)
    assert.equal(text.startsWith('字'.repeat(DOCUMENT_TEXT_MAX_CHARS - 1)), true)
    assert.equal(text.includes('😀'), false)
    assert.match(text, new RegExp(`\\[Truncated: the file has ${long.length} characters; only the first ${DOCUMENT_TEXT_MAX_CHARS - 1} are included\\.\\]$`))
  })

  it('图片缩放先保留原格式，再逐档转 JPEG；GIF 转 PNG；体积上限对应 4.5 MiB 的 base64', () => {
    assert.equal(Math.ceil(MODEL_IMAGE_MAX_BYTES / 3) * 4 <= 4.5 * 1024 * 1024, true)
    assert.deepEqual(modelImageProcesses('png')[0], { process: 'image/auto-orient,1/resize,m_lfit,w_2000,h_2000,limit_1', mimeType: 'image/png' })
    assert.equal(modelImageProcesses('gif')[0]!.mimeType, 'image/png')
    assert.equal(modelImageProcesses('png').slice(1).every(candidate => candidate.mimeType === 'image/jpeg'), true)
  })
})

describe('文档文字抽取（worker 线程里跑真实解析库）', { timeout: 30_000 }, () => {
  it('Excel 每个工作表写成 CSV，日期按 ISO、数字原样', async () => {
    assert.equal(
      await extractDocumentText('xlsx', await fixture('sheets.xlsx')),
      '# 9月流量\n日期,访问量,转化率\n2026-09-01,1203,0.30000000000000004\n\n# 渠道\n渠道,订单\n搜索,42',
    )
  })

  it('Word 与 PDF 取出正文；Word 里内嵌的 HTML 片段不进文字', async () => {
    const docx = await extractDocumentText('docx', await fixture('document.docx'))
    assert.match(docx, /会议纪要正文/)
    assert.equal(docx.includes('script'), false)
    assert.match(await extractDocumentText('pdf', await fixture('report.pdf')), /Kuro quarterly report/)
  })

  it('损坏的文件抛错，由上传接口拒绝', async () => {
    await assert.rejects(extractDocumentText('docx', Buffer.from('not a zip')))
    await assert.rejects(extractDocumentText('pdf', Buffer.from('%PDF-1.4 garbage')))
  })
})
