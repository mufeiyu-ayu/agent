import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { safeRedirect } from './safe-redirect'

describe('safeRedirect', () => {
  it('只放行站内路径', () => {
    assert.equal(safeRedirect('/workspace?x=1'), '/workspace?x=1')
    assert.equal(safeRedirect('//evil.example'), '/workspace')
    assert.equal(safeRedirect('/\\evil.example'), '/workspace')
    assert.equal(safeRedirect('https://evil.example'), '/workspace')
    assert.equal(safeRedirect(undefined), '/workspace')
    assert.equal(safeRedirect(['/a']), '/workspace')
  })
})
