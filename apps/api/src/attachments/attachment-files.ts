import type { AttachmentKind } from '@agent/contracts'
import type { Buffer } from 'node:buffer'
import {
  ATTACHMENT_FILE_EXTENSIONS,
  ATTACHMENT_FILE_MAX_BYTES,
  ATTACHMENT_IMAGE_EXTENSIONS,
  ATTACHMENT_IMAGE_MAX_BYTES,
} from '@agent/contracts'

/**
 * 发给模型的图片上限（照抄 Pi `image-resize-core.ts`，ce950d78）：长宽各不超过 2000，base64 不超过 4.5 MiB
 * （给 Anthropic 的 5 MB 上限留余量）。超出的在上传时缩放一次，结果另存一份，之后每轮发的都是同一份字节。
 */
export const MODEL_IMAGE_MAX_SIDE = 2000
export const MODEL_IMAGE_MAX_BYTES = Math.floor(4.5 * 1024 * 1024 * 3 / 4)

/** 每个文档给模型的文字上限（我们加的：三家都不解析文档）；超出截断并写明。 */
export const DOCUMENT_TEXT_MAX_CHARS = 40_000

/** 响应里的 Content-Type 只从这张表取，不用上传方给的值。 */
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function attachmentKindOf(name: string): AttachmentKind | undefined {
  const extension = extensionOf(name)
  if ((ATTACHMENT_IMAGE_EXTENSIONS as readonly string[]).includes(extension))
    return 'image'
  return (ATTACHMENT_FILE_EXTENSIONS as readonly string[]).includes(extension) ? 'file' : undefined
}

export function attachmentMaxBytes(kind: AttachmentKind): number {
  return kind === 'image' ? ATTACHMENT_IMAGE_MAX_BYTES : ATTACHMENT_FILE_MAX_BYTES
}

export function contentTypeOf(name: string): string {
  return CONTENT_TYPES[extensionOf(name)] ?? 'application/octet-stream'
}

/** 文件名不可信：去掉路径与控制字符，限长；清完是空的就不要。 */
export function safeAttachmentName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001F\u007F]/g, '').split(/[/\\]/).at(-1)!.trim().slice(0, 200)
}

/**
 * 内容与扩展名对不上的直接拒绝：改了后缀的可执行文件、把 HTML 改名成图片这类，进不了存储。
 * 文本类没有文件头，交给 `decodeText` 判断是不是文字。
 */
export function matchesFileSignature(name: string, content: Buffer): boolean {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => content[index] === byte)

  switch (extensionOf(name)) {
    case 'png': return startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    case 'jpg':
    case 'jpeg': return startsWith(0xFF, 0xD8, 0xFF)
    case 'gif': return startsWith(0x47, 0x49, 0x46, 0x38)
    case 'webp': return startsWith(0x52, 0x49, 0x46, 0x46) && content.subarray(8, 12).toString('latin1') === 'WEBP'
    case 'pdf': return startsWith(0x25, 0x50, 0x44, 0x46, 0x2D)
    // docx / xlsx 都是 zip。
    case 'docx':
    case 'xlsx': return startsWith(0x50, 0x4B, 0x03, 0x04)
    default: return true
  }
}

/**
 * 文本文件解码成字符串：先按 UTF-8，解不开再按 GB18030（中文 Windows 的 Excel 导出的 CSV 常是 GBK）。
 * 含 NUL 的当二进制，返回 undefined。
 */
export function decodeText(content: Buffer): string | undefined {
  if (content.includes(0))
    return undefined

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content)
  }
  catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(content)
    }
    catch {
      return undefined
    }
  }
}

/** 给模型的文档正文：去掉 BOM 与首尾空白，超出上限截断并告诉模型被截断了；空文档也写明，不发空标签。 */
export function toModelDocumentText(text: string): string {
  const cleaned = text.replace(/^\uFEFF/, '').trim()
  if (!cleaned)
    return '[This file contains no extractable text.]'
  if (cleaned.length <= DOCUMENT_TEXT_MAX_CHARS)
    return cleaned

  // 不在代理对中间切开。
  const head = cleaned.slice(0, DOCUMENT_TEXT_MAX_CHARS).replace(/[\uD800-\uDBFF]$/, '')
  return `${head}\n[Truncated: the file has ${cleaned.length} characters; only the first ${head.length} are included.]`
}

/** 对象 key：先按用户分。和工作区的 `users/<id>/conversations/` 前缀分开，那边的回收会列举整个会话前缀。 */
export function attachmentObjectKey(userId: string, attachmentId: string, variant: 'original' | 'model'): string {
  return `users/${userId}/attachments/${attachmentId}/${variant}`
}

/**
 * OSS 图片处理参数。尺寸够用就保留原格式；还是太大就转 JPEG 并逐档压（同 Pi 的做法：取第一个不超上限的）。
 * GIF 缩放时转成 PNG，只留第一帧。
 */
export function modelImageProcesses(sourceExtension: string): Array<{ process: string, mimeType: string }> {
  const fit = (side: number) => `image/auto-orient,1/resize,m_lfit,w_${side},h_${side},limit_1`
  const keepFormat = sourceExtension === 'gif'
    ? { process: `${fit(MODEL_IMAGE_MAX_SIDE)}/format,png`, mimeType: 'image/png' }
    : { process: fit(MODEL_IMAGE_MAX_SIDE), mimeType: contentTypeOf(`x.${sourceExtension}`) }

  return [
    keepFormat,
    ...[[MODEL_IMAGE_MAX_SIDE, 80], [MODEL_IMAGE_MAX_SIDE, 55], [1500, 55], [1000, 55]].map(([side, quality]) => ({
      process: `${fit(side!)}/format,jpg/quality,q_${quality}`,
      mimeType: 'image/jpeg',
    })),
  ]
}

/** 消息列表里的缩略图：最长边 640，保留原格式。 */
export const THUMBNAIL_PROCESS = 'image/auto-orient,1/resize,m_lfit,w_640,h_640,limit_1'
