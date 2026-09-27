import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { safeRedirect } from './auth.state'

describe('safeRedirect', () => {
  it('只放行站内路径', () => {
    assert.equal(safeRedirect('/users?x=1'), '/users?x=1')
    assert.equal(safeRedirect('//evil.example'), '/overview')
    assert.equal(safeRedirect('/\\evil.example'), '/overview')
    assert.equal(safeRedirect('https://evil.example'), '/overview')
    assert.equal(safeRedirect(undefined), '/overview')
  })
})
