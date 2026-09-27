import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { hashPassword, verifyPassword } from './password.js'

describe('password', () => {
  it('哈希串被截断或参数损坏时一律判错，不放行任意密码', async () => {
    const stored = await hashPassword('correct-password')
    const [algorithm, n, r, p, salt] = stored.split('$')

    assert.equal(await verifyPassword('correct-password', stored), true)
    assert.equal(await verifyPassword('wrong-password', stored), false)
    assert.equal(await verifyPassword('anything', [algorithm, n, r, p, salt, '***'].join('$')), false)
    assert.equal(await verifyPassword('anything', [algorithm, 'x', r, p, salt, stored.split('$')[5]].join('$')), false)
  })
})
