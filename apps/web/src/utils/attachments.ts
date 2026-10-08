import type { ChatAttachment } from '../types/chat'
import { ATTACHMENT_FILE_MAX_BYTES, ATTACHMENT_IMAGE_EXTENSIONS, ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_MAX_COUNT } from '@agent/contracts'

const IMAGE_EXTENSIONS: readonly string[] = ATTACHMENT_IMAGE_EXTENSIONS
/** 值是点击后的预览方式：图片全屏看，其余在右侧面板里渲染。 */
const FILE_PREVIEWS: Record<string, AttachmentPreviewMode> = {
  md: 'markdown',
  txt: 'text',
  csv: 'table',
  json: 'text',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'sheet',
}

export type AttachmentPreviewMode = 'image' | 'markdown' | 'text' | 'table' | 'sheet' | 'docx' | 'pdf'

export type AttachmentRejectReason = 'unsupported' | 'tooLarge' | 'duplicate' | 'tooMany'

/** 文件选择框的 accept。系统给 md / csv 的 MIME 不可靠，类型一律按扩展名判断。 */
export const ATTACHMENT_ACCEPT = [...IMAGE_EXTENSIONS, ...Object.keys(FILE_PREVIEWS)].map(extension => `.${extension}`).join(',')

/** 拆成「主名 + 扩展名」：卡片里主名过长时截断，扩展名始终可见。 */
export function splitFileName(name: string): [base: string, extension: string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

function extensionOf(name: string): string {
  return splitFileName(name)[1].slice(1).toLowerCase()
}

export function attachmentKind(name: string): ChatAttachment['kind'] | undefined {
  const extension = extensionOf(name)
  if (IMAGE_EXTENSIONS.includes(extension))
    return 'image'
  return Object.hasOwn(FILE_PREVIEWS, extension) ? 'file' : undefined
}

export function attachmentPreviewMode(name: string): AttachmentPreviewMode | undefined {
  return attachmentKind(name) === 'image' ? 'image' : FILE_PREVIEWS[extensionOf(name)]
}

export function attachmentMaxBytes(name: string): number {
  return attachmentKind(name) === 'image' ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_FILE_MAX_BYTES
}

/**
 * 按顺序收下还放得进的文件；被拒的各自带原因，调用方提示第一条。
 * 同名且大小相同的算同一个文件，已在列表里或同一批里出现过的不再收。
 */
export function validateAttachments(existing: Array<{ name: string, bytes: number }>, files: Array<{ name: string, size: number }>) {
  const accepted: number[] = []
  const rejected: Array<{ name: string, reason: AttachmentRejectReason }> = []
  const seen = new Set(existing.map(item => `${item.bytes}:${item.name}`))

  files.forEach((file, index) => {
    const identity = `${file.size}:${file.name}`

    if (!attachmentKind(file.name))
      rejected.push({ name: file.name, reason: 'unsupported' })
    else if (file.size > attachmentMaxBytes(file.name))
      rejected.push({ name: file.name, reason: 'tooLarge' })
    else if (seen.has(identity))
      rejected.push({ name: file.name, reason: 'duplicate' })
    else if (existing.length + accepted.length >= ATTACHMENT_MAX_COUNT)
      rejected.push({ name: file.name, reason: 'tooMany' })
    else
      accepted.push(index)

    seen.add(identity)
  })

  return { accepted, rejected }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 单张图片在消息里的显示尺寸：等比缩到 max 以内，不放大。
 * 极长或极扁的图短边会缩得看不清，短边保底 min（原图更小就用原图），多出的部分由 object-cover 裁掉。
 */
export function fitImageSize(width: number, height: number, max = 320, min = 120) {
  const scale = Math.min(1, max / width, max / height)
  const side = (natural: number) => Math.round(Math.max(Math.min(min, natural), natural * scale))
  return { width: side(width), height: side(height) }
}

/** CSV 拆成行列：支持引号包住的逗号、换行与 `""` 转义；末尾的空行不要。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!

    if (quoted) {
      if (char !== '"')
        cell += char
      else if (text[index + 1] === '"')
        cell += text[index++]
      else
        quoted = false
    }
    else if (char === '"') {
      quoted = true
    }
    else if (char === ',') {
      row.push(cell)
      cell = ''
    }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n')
        index++
      rows.push([...row, cell])
      row = []
      cell = ''
    }
    else {
      cell += char
    }
  }

  if (cell || row.length > 0)
    rows.push([...row, cell])
  return rows.filter(cells => cells.some(Boolean))
}

/** 文本文件解码：先按 UTF-8，解不开再按 GB18030（中文 Windows 的 Excel 导出的 CSV 常是 GBK），与后端抽文字时一致。 */
export function decodeText(content: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  }
  catch {
    return new TextDecoder('gb18030').decode(content)
  }
}
