/* eslint-disable perfectionist/sort-imports */
import 'reflect-metadata'

import type { ArgumentMetadata } from '@nestjs/common'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { SEO_CHAT_MESSAGE_MAX_CHARS } from '@agent/contracts'
import { BadRequestException } from '@nestjs/common'
import { validate } from 'class-validator'

import { createAppValidationPipe } from '../../common/pipes/app-validation.pipe.js'
import { SeoChatDto } from './seo-chat.dto.js'

/** 只由常规空白构成的消息，必须在 DTO / 全局 Pipe 边界被拒绝。 */
const BLANK_MESSAGES = [
  '',
  '   ',
  '\t\n\r',
  '\u00A0',
  '\u3000',
  ' \t\n\u00A0\u3000 ',
]

/** 至少含一个 `\S` 字符的消息，必须继续通过。 */
const MEANINGFUL_MESSAGES = [
  ' \n hi \t ',
  '0',
  '中',
]

/** 用于验证错误响应没有回显失败字段原始值的哨兵值。 */
const CONVERSATION_SENTINEL = 'conversation-sentinel-1'

const BODY_METADATA: ArgumentMetadata = {
  type: 'body',
  metatype: SeoChatDto,
  data: undefined,
}

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

  it('拒绝只包含空白字符的用户消息', async () => {
    for (const message of BLANK_MESSAGES) {
      const errors = await validate(createDto(message))

      assert.equal(
        errors.some(error => error.property === 'message'),
        true,
        `未拒绝空白消息：${JSON.stringify(message)}`,
      )
    }
  })

  it('接受含非空白字符的用户消息', async () => {
    for (const message of MEANINGFUL_MESSAGES) {
      const errors = await validate(createDto(message))

      assert.equal(
        errors.some(error => error.property === 'message'),
        false,
        `误拒绝有效消息：${JSON.stringify(message)}`,
      )
    }
  })

  it('MaxLength 仍在 trim 前生效，前导空白计入长度', async () => {
    const errors = await validate(createDto(
      `${' '.repeat(10)}${'a'.repeat(SEO_CHAT_MESSAGE_MAX_CHARS)}`,
    ))

    assert.equal(
      errors.some(error => error.property === 'message'),
      true,
    )
  })

  it('拒绝不在白名单内的 model', async () => {
    const errors = await validate(createDto('hi', 'gpt-4o'))

    assert.equal(
      errors.some(error => error.property === 'model'),
      true,
    )
  })
})

describe('SeoChatDto 在 App ValidationPipe 边界的行为', () => {
  it('纯空白 body 抛出 400 且不进入下游处理', async () => {
    const pipe = createAppValidationPipe({ expectedType: SeoChatDto })

    for (const message of BLANK_MESSAGES) {
      let downstreamCalled = false

      try {
        const transformed: unknown = await pipe.transform(
          createPayload(message),
          BODY_METADATA,
        )

        downstreamCalled = true
        void transformed
      }
      catch (error) {
        assert.ok(error instanceof BadRequestException)
        assert.equal(error.getStatus(), 400)

        const response = error.getResponse() as {
          message: string
          details: string[]
        }

        assert.equal(response.message, '请求参数校验失败')
        assert.equal(
          response.details.some(detail => detail.startsWith('message:')),
          true,
        )

        // 错误响应不得回显请求正文。直接比对未序列化的 details，
        // 避免 JSON 转义把 \t \n \r 变成两字符序列后断言恒真。
        if (message !== '') {
          assert.equal(
            response.details.join('\n').includes(message),
            false,
          )
        }
      }

      assert.equal(
        downstreamCalled,
        false,
        `空白消息越过了 Pipe：${JSON.stringify(message)}`,
      )
    }
  })

  it('校验失败字段的原始值不会被回显到错误详情', async () => {
    const pipe = createAppValidationPipe({ expectedType: SeoChatDto })
    const payload = {
      ...createPayload('hi'),
      // 超过 conversationId 的 128 字符上限，让该字段本身成为失败字段，
      // 这样「不回显原始值」才是一个真正可能失败的断言。
      conversationId: CONVERSATION_SENTINEL.repeat(20),
    }

    await assert.rejects(
      () => pipe.transform(payload, BODY_METADATA),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException)

        const response = error.getResponse() as { details: string[] }
        const detailText = response.details.join('\n')

        assert.equal(detailText.includes('conversationId:'), true)
        assert.equal(detailText.includes(CONVERSATION_SENTINEL), false)

        return true
      },
    )
  })

  it('含非空白字符的 body 通过校验且保留原始空白', async () => {
    const pipe = createAppValidationPipe({ expectedType: SeoChatDto })
    const transformed: unknown = await pipe.transform(
      createPayload(' hi '),
      BODY_METADATA,
    )

    assert.ok(transformed instanceof SeoChatDto)
    assert.equal(transformed.message, ' hi ')
  })

  it('reasoningEffort 仅放行 low / high / max，省略保持 legacy 兼容', async () => {
    const pipe = createAppValidationPipe({ expectedType: SeoChatDto })

    for (const reasoningEffort of ['low', 'high', 'max']) {
      const transformed = await pipe.transform({
        ...createPayload('hi'),
        reasoningEffort,
      }, BODY_METADATA) as SeoChatDto

      assert.equal(transformed.reasoningEffort, reasoningEffort)
    }

    const legacy = await pipe.transform(createPayload('hi'), BODY_METADATA) as SeoChatDto
    assert.equal(legacy.reasoningEffort, undefined)

    for (const reasoningEffort of ['unknown', '', ' ', 1, null, true]) {
      await assert.rejects(
        () => pipe.transform({
          ...createPayload('hi'),
          reasoningEffort,
        }, BODY_METADATA),
        BadRequestException,
      )
    }
  })
})

function createDto(message: string, model = 'deepseek-v4-flash'): SeoChatDto {
  return Object.assign(new SeoChatDto(), {
    conversationId: 'conversation-1',
    message,
    model,
  })
}

function createPayload(message: string) {
  return {
    conversationId: 'conversation-1',
    message,
    model: 'deepseek-v4-flash',
  }
}
