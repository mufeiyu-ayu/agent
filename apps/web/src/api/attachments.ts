import type { MessageAttachment } from '@agent/contracts'
import { http } from './http'

interface UploadAttachmentOptions {
  signal: AbortSignal
  /** 0–1。 */
  onProgress: (progress: number) => void
}

/**
 * 上传一个文件，返回服务端的附件记录。文件名单独放一个字段：
 * multipart 的文件名参数在服务端默认按 latin1 解码，中文名会乱码。
 * 服务端收完后还要校验、抽文字、存储，所以不设默认的 10 秒超时。
 */
export async function uploadAttachment(file: File, options: UploadAttachmentOptions): Promise<MessageAttachment> {
  const form = new FormData()
  form.append('name', file.name)
  form.append('file', file)

  const response = await http.post<MessageAttachment>('/api/attachments', form, {
    signal: options.signal,
    timeout: 120_000,
    onUploadProgress: event => options.onProgress(event.total ? event.loaded / event.total : 0),
  })
  return response.data
}

/** 发送前移除一个已上传的附件。失败不用管：没发出去的上传服务端过期会自己清掉。 */
export function deleteAttachment(id: string): void {
  http.delete(`/api/attachments/${encodeURIComponent(id)}`).catch(() => {})
}

/** 附件内容的地址：私有存储，经后端校验归属后读取；`thumb` 是消息列表里用的缩略图。 */
export function attachmentContentUrl(id: string, variant?: 'thumb'): string {
  return `/api/attachments/${encodeURIComponent(id)}/content${variant ? `?variant=${variant}` : ''}`
}
