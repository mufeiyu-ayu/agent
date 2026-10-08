import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { it } from 'vitest'
import { extractDocumentText } from './document-text.js'

it('文档解析：只接收两路运行和八个等待，取消等待者释放名额，不影响其他文件', { timeout: 30_000 }, async () => {
  const file = await readFile(new URL('./__fixtures__/document.docx', import.meta.url))
  const controller = new AbortController()
  const active = [extractDocumentText('docx', file), extractDocumentText('docx', file)]
  const cancelled = extractDocumentText('docx', file, controller.signal)
  const waiting = Array.from({ length: 7 }, () => extractDocumentText('docx', file))
  const overflow = extractDocumentText('docx', file)
  const reason = new Error('upload disconnected')
  controller.abort(reason)
  await assert.rejects(cancelled, error => error === reason)
  await assert.rejects(overflow, /文件解析繁忙/)
  const replacement = extractDocumentText('docx', file)
  const texts = await Promise.all([...active, ...waiting, replacement])
  assert.equal(texts.length, 10)
  assert.ok(texts.every(text => text.includes('会议纪要正文')))
})
