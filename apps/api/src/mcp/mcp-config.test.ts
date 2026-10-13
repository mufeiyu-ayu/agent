import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'vitest'
import { compileMcpSchema, mcpResultText } from './mcp-client.js'
import { checkHeaders, checkIcon, mcpUrl, parseMcpImport } from './mcp-config.js'

describe('MCP 配置与结果边界', () => {
  it('导入多服务、密钥和 OAuth，解析不发请求、不自动启用', () => {
    const result = parseMcpImport(
      JSON.stringify({
        mcpServers: {
          docs: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { 'X-Goog-Api-Key': 'test-only-key' },
          },
          oauth: {
            url: 'https://other.example/mcp',
            oauth: { clientId: 'id', clientSecret: 'secret', scope: 'read' },
          },
        },
      }),
    )
    assert.equal(result.length, 2)
    assert.equal(result[0]!.config.authType, 'headers')
    assert.equal(result[0]!.headers['x-goog-api-key'], 'test-only-key')
    assert.equal(result[1]!.config.oauthClientId, 'id')
  })
  it('拒绝 stdio、未知字段、旧 SSE 和环境变量引用', () => {
    for (const config of [
      { command: 'npx', args: ['evil'] },
      { url: 'https://example.com', type: 'sse' },
      { url: 'https://example.com', headers: { Authorization: '$' + '{TOKEN}' } },
      { url: 'https://example.com', environment: {} },
    ]) {
      assert.throws(() => parseMcpImport(JSON.stringify({ mcpServers: { test: config } })))
    }
  })
  it('凭据不能放 URL，也不能注入 HTTP 控制头', () => {
    for (const url of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com?api_key=secret',
      'https://example.com#token',
    ])
      assert.throws(() => mcpUrl(url))
    for (const name of ['Host', 'Cookie', 'Content-Length', 'Mcp-Session-Id'])
      assert.throws(() => checkHeaders({ [name]: 'value' }, [name]))
    assert.throws(() => checkHeaders({ Authorization: 'test\r\nHost: localhost' }, ['Authorization']))
    assert.deepEqual(checkHeaders({ authorization: 'Bearer test' }, ['Authorization']), {
      authorization: 'Bearer test',
    })
  })
  it('图标限制为小 PNG，拒绝 SVG 和伪装图片', () => {
    const png
      = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII='
    assert.equal(checkIcon(png), png)
    assert.throws(() => checkIcon('data:image/svg+xml;base64,PHN2Zz4='))
    assert.throws(() => checkIcon(`data:image/png;base64,${Buffer.from('<html>bad').toString('base64')}`))
  })
  it('动态参数规格保留嵌套、枚举与必填校验', () => {
    const valid = compileMcpSchema({
      type: 'object',
      properties: {
        mode: { enum: ['read'] },
        nested: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer' } },
        },
      },
      required: ['mode', 'nested'],
      additionalProperties: false,
    })
    assert.equal(valid({ mode: 'read', nested: { id: 1 } }), true)
    for (const input of [{}, { mode: 'write', nested: { id: 1 } }, { mode: 'read', nested: { id: '1' } }])
      assert.equal(valid(input), false)
  })
  it('参数名称和常量数据可以叫 pattern，但真实正则校验规格仍拒绝', () => {
    const validate = compileMcpSchema({
      type: 'object',
      properties: { pattern: { type: 'string' }, value: { const: { pattern: 'data' } } },
      required: ['pattern'],
    })
    assert.equal(validate({ pattern: '*.ts', value: { pattern: 'data' } }), true)
    assert.equal(validate({ pattern: 1 }), false)
    assert.throws(
      () => compileMcpSchema({ type: 'object', properties: { query: { type: 'string', pattern: '(a+)+$' } } }),
      /正则/,
    )
  })

  it('本地引用的目标同样校验，不允许从数据位置或动态身份绕过正则限制', () => {
    for (const location of ['examples', 'default', 'x-schema']) {
      assert.throws(() => compileMcpSchema({ type: 'object', properties: { q: { $ref: `#/${location}/0` } }, [location]: [{ type: 'string', pattern: '(a+)+$' }] }), /正则/)
    }
    const validate = compileMcpSchema({ type: 'object', properties: { q: { $ref: '#/$defs/query' } }, $defs: { query: { type: 'string' } } })
    assert.equal(validate({ q: 'text' }), true)
    assert.equal(validate({ q: 1 }), false)
    assert.throws(() => compileMcpSchema({ type: 'object', properties: { q: { $ref: '#/$defs/query' } }, $defs: { query: { $ref: '#/$defs/query' } } }), /递归/)
    assert.throws(() => compileMcpSchema({ type: 'object', properties: { q: { $dynamicRef: '#value' } } }), /动态/)
    assert.throws(() => compileMcpSchema({ type: 'object', properties: { q: { $id: 'https://other.example/schema', type: 'string' } } }), /身份/)
  })

  it('结果保留结构化数据与不支持类型的提示，不产生空白成功', () => {
    assert.match(mcpResultText({ content: [], structuredContent: { count: 3 } }), /"count":3/)
    assert.match(
      mcpResultText({
        content: [{ type: 'image', mimeType: 'image/png', data: 'test' }],
      }),
      /暂不支持.*image/,
    )
    assert.match(mcpResultText({ content: [], isError: true }), /失败/)
  })
})
