/**
 * 用户随消息发出的附件：上传的大小 / 数量 / 类型约束两端共用，后端校验与前台选择框、提示都以这里为准。
 * 类型一律按扩展名判断：系统给 md / csv 的 MIME 不可靠。
 */
export const ATTACHMENT_MAX_COUNT = 10
export const ATTACHMENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const ATTACHMENT_FILE_MAX_BYTES = 20 * 1024 * 1024

export const ATTACHMENT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const
export const ATTACHMENT_FILE_EXTENSIONS = ['md', 'txt', 'csv', 'json', 'pdf', 'docx', 'xlsx'] as const

export type AttachmentKind = 'image' | 'file'

/** 上传成功的返回，也是消息列表里每个附件的形状；内容经 `GET /api/attachments/:id/content` 读取。 */
export interface MessageAttachment {
  id: string
  kind: AttachmentKind
  name: string
  bytes: number
  /** 图片的原始尺寸；读不到时没有。 */
  width?: number
  height?: number
}
