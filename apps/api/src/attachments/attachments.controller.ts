import type { ServerResponse } from 'node:http'
import type { AuthContext } from '../auth/auth.decorators.js'
import { Buffer } from 'node:buffer'
import { pipeline } from 'node:stream/promises'
import { ATTACHMENT_FILE_MAX_BYTES } from '@agent/contracts'
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { CurrentAuth } from '../auth/auth.decorators.js'
import { AttachmentsService } from './attachments.service.js'

@Controller('attachments')
export class AttachmentsController {
  constructor(@Inject(AttachmentsService) private readonly attachments: AttachmentsService) {}

  /**
   * 上传一个文件（multipart：`file` 是内容，`name` 是文件名）。文件名单独传：
   * multipart 文件名参数默认按 latin1 解码，中文名会乱码，普通字段是 UTF-8。
   * 整个文件读进内存（上限 20 MB）：后面要校验内容、抽文字。
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_FILE_MAX_BYTES, files: 1 } }))
  upload(@CurrentAuth() auth: AuthContext, @UploadedFile() file: { buffer: Buffer } | undefined, @Body('name') name: unknown, @Res({ passthrough: true }) response: ServerResponse) {
    if (!file || !Buffer.isBuffer(file.buffer) || typeof name !== 'string' || !name.trim())
      throw new BadRequestException('缺少文件或文件名')

    const controller = new AbortController()
    response.once('close', () => controller.abort(new Error('attachment upload disconnected')))
    if (response.destroyed)
      controller.abort(new Error('attachment upload disconnected'))
    return this.attachments.upload(auth.user.id, { name, content: file.buffer, signal: controller.signal })
  }

  /**
   * 附件内容：图片可带 `?variant=thumb` 取缩略图。Content-Type 只按扩展名从固定表里取，加 nosniff，
   * 浏览器不会把内容当成别的类型执行。内容不会变、地址里的 id 猜不到，只让浏览器自己长期缓存（private）：
   * 消息列表里的缩略图不用每次进会话都经后端从存储重取。
   */
  @Get(':id/content')
  async content(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @Query('variant') variant: string | undefined, @Res() response: ServerResponse) {
    const file = await this.attachments.open(auth.user.id, id, variant)

    response.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Disposition': `${file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
    // 用户关页或切走时连接断开，pipeline 以错误结束并销毁 OSS 流；响应头已发出，没有可回的内容。
    await pipeline(file.stream, response).catch(() => {})
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id') id: string): Promise<void> {
    await this.attachments.remove(auth.user.id, id)
  }
}
