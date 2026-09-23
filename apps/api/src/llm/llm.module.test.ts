import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { LLMConfigError } from '@agent/ai'

import { createApiKeyCipher, toApiKeyLast4 } from './api-key-cipher.js'
import { resolveLlmEnvConfig } from './llm-runtime-config.service.js'

const SECRET_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('resolveLlmEnvConfig', () => {
  it('只读主密钥与 debug 开关，模型接入配置不再来自 env', () => {
    assert.deepEqual(
      resolveLlmEnvConfig({ AGENT_SECRET_KEY: ` ${SECRET_KEY} ` }),
      { secretKey: SECRET_KEY, captureModelIO: false },
    )
    assert.equal(
      resolveLlmEnvConfig({
        AGENT_SECRET_KEY: SECRET_KEY,
        AGENT_DEBUG_CAPTURE_MODEL_IO: 'true',
      }).captureModelIO,
      true,
    )
  })

  it('AGENT_SECRET_KEY 是 #156 前模板里公开的占位串时启动失败，文案指明是占位串而不是长度', () => {
    assert.throws(
      () => resolveLlmEnvConfig({ AGENT_SECRET_KEY: ' replace-with-openssl-rand-hex-32-output ' }),
      (error: unknown) => {
        assert.ok(error instanceof LLMConfigError)
        assert.match(error.message, /公开的占位串/)
        assert.doesNotMatch(error.message, /不少于 32/)
        return true
      },
    )
  })

  it('AGENT_SECRET_KEY 缺失或短于 32 个字符时启动失败', () => {
    for (const env of [{}, { AGENT_SECRET_KEY: '' }, { AGENT_SECRET_KEY: 'short-secret' }]) {
      assert.throws(
        () => resolveLlmEnvConfig(env as NodeJS.ProcessEnv),
        (error: unknown) => {
          assert.ok(error instanceof LLMConfigError)
          assert.match(error.message, /AGENT_SECRET_KEY/)
          return true
        },
      )
    }
  })
})

describe('createApiKeyCipher', () => {
  it('加密后不含明文，同一密钥能解回；每次加密 IV 不同', () => {
    const cipher = createApiKeyCipher(SECRET_KEY)
    const apiKey = 'sk-test-not-a-real-key'
    const first = cipher.encrypt(apiKey)
    const second = cipher.encrypt(apiKey)

    assert.match(first, /^v1:[^:]+:[^:]+:[^:]+$/)
    assert.doesNotMatch(first, /sk-test/)
    assert.notEqual(first, second)
    assert.equal(cipher.decrypt(first), apiKey)
    assert.equal(cipher.decrypt(second), apiKey)
    assert.equal(toApiKeyLast4(apiKey), '-key')
  })

  it('固定认证标签长度前写入的密文照常解密', () => {
    // 与加密逻辑同款算法、以 SECRET_KEY 离线生成的固定密文（16 字节标签），代表库里已有的数据。
    const stored = 'v1:MSs02au1tXyGfe84:Wv52sw3PntE/F+7gqIJa5w==:5ek9XzoF9lLhed+XfQxpdYQGzN+NpQ=='

    assert.equal(createApiKeyCipher(SECRET_KEY).decrypt(stored), 'sk-test-not-a-real-key')
  })

  it('认证标签被截短的密文解密失败', () => {
    const cipher = createApiKeyCipher(SECRET_KEY)
    const [version, iv, tag, ciphertext] = cipher.encrypt('sk-test-not-a-real-key').split(':')
    const truncatedTag = Buffer.from(tag!, 'base64').subarray(0, 4).toString('base64')

    assert.throws(() => cipher.decrypt([version, iv, truncatedTag, ciphertext].join(':')), /authentication tag length/i)
  })

  it('换主密钥或篡改密文都无法解密', () => {
    const cipher = createApiKeyCipher(SECRET_KEY)
    const payload = cipher.encrypt('sk-secret')

    assert.throws(() => createApiKeyCipher(`${SECRET_KEY}-rotated`).decrypt(payload))
    assert.throws(() => cipher.decrypt(`${payload.slice(0, -2)}AA`))
    assert.throws(() => cipher.decrypt('v0:a:b:c'), /格式不合法/)
  })
})
