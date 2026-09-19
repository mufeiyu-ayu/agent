import type { AdminRunDetailRecord } from './admin-run.projector.js'

/** projector 测试共用的 detail Run 行；`steps` 由各测试自己填。 */
export function runRecord(): AdminRunDetailRecord {
  return {
    id: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'message-assistant',
    status: 'COMPLETED',
    startedAt: new Date('2026-08-09T00:00:00.000Z'),
    endedAt: new Date('2026-08-09T00:00:03.000Z'),
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    updatedAt: new Date('2026-08-09T00:00:03.000Z'),
    userMessage: {
      id: 'message-user',
      role: 'USER',
      status: 'COMPLETED',
      content: '站内有哪些 SEO 指南？',
      createdAt: new Date('2026-08-09T00:00:00.000Z'),
      updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    },
    assistantMessage: {
      id: 'message-assistant',
      role: 'ASSISTANT',
      status: 'COMPLETED',
      content: '已根据站内资料回答。',
      createdAt: new Date('2026-08-09T00:00:00.100Z'),
      updatedAt: new Date('2026-08-09T00:00:03.000Z'),
      grounding: null,
    },
    steps: [],
  }
}

export function step(
  sequence: number,
  type: string,
  overrides: Record<string, unknown> = {},
): AdminRunDetailRecord['steps'][number] {
  return {
    id: `step-${sequence}`,
    sequence,
    type,
    title: `Step ${sequence}`,
    status: 'COMPLETED',
    input: null,
    output: null,
    errorMessage: null,
    startedAt: new Date(`2026-08-09T00:00:0${Math.min(sequence, 9)}.000Z`),
    endedAt: new Date(`2026-08-09T00:00:0${Math.min(sequence, 9)}.100Z`),
    ...overrides,
  }
}
