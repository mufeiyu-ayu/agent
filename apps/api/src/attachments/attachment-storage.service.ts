import type { Readable } from 'node:stream'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import OSS from 'ali-oss'

/**
 * 附件在私有 OSS 里的读写。和工作区共用同一个 Bucket 与凭据，但前缀、对象语义与清理都各管各的：
 * 这里的对象只按数据库里记下的确切 key 读写删，不列举前缀。
 */
@Injectable()
export class AttachmentStorageService {
  private client: OSS | undefined

  get configured(): boolean {
    return ['OSS_BUCKET', 'OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'].every(name => process.env[name]?.trim())
  }

  get bucket(): string {
    return process.env.OSS_BUCKET?.trim() ?? ''
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    await this.oss.put(key, content, { headers: { 'Content-Type': contentType }, timeout: 60_000 })
  }

  /** `process` 是 OSS 图片处理参数（缩放、转格式），省略读原对象。 */
  async read(key: string, process?: string): Promise<Buffer> {
    const result = await this.oss.get(key, { ...(process ? { process } : {}), timeout: 30_000 })
    return Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content)
  }

  async stream(key: string, process?: string): Promise<Readable> {
    return (await this.oss.getStream(key, { ...(process ? { process } : {}), timeout: 30_000 })).stream as Readable
  }

  /** OSS 解不出图片时返回 400，这里原样抛出，由上传接口按「图片读不出来」拒绝。 */
  async imageSize(key: string): Promise<{ width: number, height: number }> {
    const info = JSON.parse((await this.read(key, 'image/info')).toString('utf8')) as Record<string, { value?: string } | undefined>
    const width = Number(info.ImageWidth?.value)
    const height = Number(info.ImageHeight?.value)
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
      throw new Error('image/info 没有返回尺寸')
    return { width, height }
  }

  /** DeleteObject 对不存在的对象也返回成功，重复清理是安全的。 */
  async delete(key: string): Promise<void> {
    await this.oss.delete(key, { timeout: 15_000 })
  }

  private get oss(): OSS {
    if (!this.configured)
      throw new ServiceUnavailableException('文件存储尚未配置，请联系管理员。')

    const options = {
      bucket: this.bucket,
      region: process.env.OSS_REGION!.trim(),
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!.trim(),
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!.trim(),
      secure: true,
      authorizationV4: true,
      timeout: 30_000,
      // 不让 SDK 自动重试：失败如实抛出，由上传接口或后台清理决定下一步。
      retryMax: 0,
      enableProxy: false,
    }
    this.client ??= new OSS(options)
    return this.client
  }
}

/** 对象不存在：区别于网络或权限问题，调用方据此决定降级还是报错。 */
export function isMissingObject(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (('code' in error && error.code === 'NoSuchKey') || ('status' in error && Number(error.status) === 404))
}
