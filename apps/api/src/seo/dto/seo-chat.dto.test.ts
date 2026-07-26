import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { SEO_CHAT_MESSAGE_MAX_CHARS } from '@agent/contracts'
import { validate } from 'class-validator'

import { SeoChatDto } from './seo-chat.dto.js'

describe('SeoChatDto', () => {
  it('接受共享上限内的用户消息', async () => {
    const errors = await validate(createDto('a'.repeat(SEO_CHAT_MESSAGE_MAX_CHARS)))

    assert.equal(errors.length, 0)
  })

  it('拒绝超过共享上限的用户消息', async () => {
    const errors = await validate(createDto(
      'a'.repeat(SEO_CHAT_MESSAGE_MAX_CHARS + 1),
    ))

    assert.equal(
      errors.some(error => error.property === 'message'),
      true,
    )
  })
})

function createDto(message: string): SeoChatDto {
  return Object.assign(new SeoChatDto(), {
    conversationId: 'conversation-1',
    message,
    model: 'deepseek-v4-flash',
  })
}
