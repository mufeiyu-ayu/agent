import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { LLMConfigError } from '@agent/ai'
import { describe, it } from 'vitest'

import { createApiKeyCipher, toApiKeyLast4 } from './api-key-cipher.js'
import { resolveLlmEnvConfig } from './llm-runtime-config.service.js'
import { resolveOutboundProxyConfig } from './outbound-proxy.js'

const SECRET_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

describe('resolveLlmEnvConfig', () => {
  it('只读主密钥、debug 开关与出站代理，模型接入配置不再来自 env；标准代理变量不再读取', () => {
    assert.deepEqual(
      resolveLlmEnvConfig({
        AGENT_SECRET_KEY: ` ${SECRET_KEY} `,
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        https_proxy: 'http://127.0.0.1:7890',
      }),
      { secretKey: SECRET_KEY, captureModelIO: false, outboundProxy: null },
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
        assert.ok(error instanceof LLMConfigError, 'error instanceof LLMConfigError')
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
          assert.ok(error instanceof LLMConfigError, 'error instanceof LLMConfigError')
          assert.match(error.message, /AGENT_SECRET_KEY/)
          return true
        },
      )
    }
  })
})

describe('resolveOutboundProxyConfig', () => {
  it('没配或空白时为 null', () => {
    assert.equal(resolveOutboundProxyConfig({}), null)
    assert.equal(resolveOutboundProxyConfig({ OUTBOUND_PROXY_URL: '  ' }), null)
  })

  it('http / https 地址给出 协议://主机:端口，缺省端口按协议补齐', () => {
    assert.deepEqual(
      resolveOutboundProxyConfig({ OUTBOUND_PROXY_URL: ' http://127.0.0.1:7890 ' }),
      { url: 'http://127.0.0.1:7890', address: 'http://127.0.0.1:7890', hostname: '127.0.0.1', port: 7890 },
    )
    assert.equal(resolveOutboundProxyConfig({ OUTBOUND_PROXY_URL: 'https://proxy.example' })?.address, 'https://proxy.example:443')
    assert.equal(resolveOutboundProxyConfig({ OUTBOUND_PROXY_URL: 'http://proxy.example' })?.port, 80)
    assert.equal(
      resolveOutboundProxyConfig({ OUTBOUND_PROXY_URL: 'http://host.docker.internal:7890' })?.address,
      'http://host.docker.internal:7890',
    )
  })

  it('地址带 user:pass 时 url 原样交给 undici，address 不含凭据', () => {
    const config = resolveOutboundProxyConfig({ OUTBOUND_PROXY_URL: 'http://user:pass@127.0.0.1:7890' })

    assert.equal(config?.url, 'http://user:pass@127.0.0.1:7890')
    assert.equal(config?.address, 'http://127.0.0.1:7890')
  })

  it('缺协议、socks5 或无法解析时启动失败，文案给出正确写法且不回显原值', () => {
    for (const value of ['127.0.0.1:7890', 'localhost:7890', 'socks5://user:secret@127.0.0.1:7890', 'http://']) {
      assert.throws(
        () => resolveLlmEnvConfig({ AGENT_SECRET_KEY: SECRET_KEY, OUTBOUND_PROXY_URL: value }),
        (error: unknown) => {
          assert.ok(error instanceof LLMConfigError, 'error instanceof LLMConfigError')
          assert.match(error.message, /OUTBOUND_PROXY_URL/)
          assert.match(error.message, /http:\/\/127\.0\.0\.1:7890/)
          assert.doesNotMatch(error.message, /secret/)
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
