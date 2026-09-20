import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * Provider API Key 的加解密：AES-256-GCM，密钥由 `AGENT_SECRET_KEY` 经 SHA-256 派生。
 * 存储格式 `v1:<iv>:<tag>:<ciphertext>`，三段 base64；换算法时升版本号，不做兼容层。
 */

const FORMAT_VERSION = 'v1'
const IV_BYTES = 12

export interface ApiKeyCipher {
  encrypt: (apiKey: string) => string
  decrypt: (payload: string) => string
}

export function createApiKeyCipher(secretKey: string): ApiKeyCipher {
  const key = createHash('sha256').update(secretKey, 'utf8').digest()

  return {
    encrypt(apiKey) {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])

      return [
        FORMAT_VERSION,
        iv.toString('base64'),
        cipher.getAuthTag().toString('base64'),
        ciphertext.toString('base64'),
      ].join(':')
    },
    decrypt(payload) {
      const [version, iv, tag, ciphertext] = payload.split(':')

      if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext)
        throw new Error('Provider 密钥密文格式不合法，无法解密')

      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))

      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}

/** 管理台回显用的尾四位；不足四位时原样返回，仍不泄露完整 key 之外的信息。 */
export function toApiKeyLast4(apiKey: string): string {
  return apiKey.slice(-4)
}
