import type { TokenEstimatorInput } from './deepseek-v4-token-estimator.js'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  ContextBudgetExceededError,
} from './agent-runtime.errors.js'
import { TokenEstimator } from './deepseek-v4-token-estimator.js'
import {
  InitialContextSelectionService,
  resolveInitialContextBudget,
} from './initial-context-selection.js'

describe('resolveInitialContextBudget', () => {
  it('同时受 application cap、model window、output reserve 和 safety margin 约束', () => {
    assert.equal(resolveInitialContextBudget({
      contextWindowTokens: 1_000_000,
      resolvedMaxOutputTokens: 65_536,
    }), 262_144)
    assert.equal(resolveInitialContextBudget({
      contextWindowTokens: 200_000,
      resolvedMaxOutputTokens: 65_536,
    }), 118_080)
    assert.equal(resolveInitialContextBudget({
      contextWindowTokens: 200_000,
      resolvedMaxOutputTokens: 100_000,
    }), 83_616)
  })
})

describe('InitialContextSelectionService', () => {
  it('分页选择超过 40 条短 History，并恢复稳定时间顺序', async () => {
    const candidates = Array.from({ length: 60 }, (_, index) => ({
      id: `message-${String(60 - index).padStart(2, '0')}`,
      createdAt: new Date(60 - index),
      message: {
        role: 'user' as const,
        content: `history-${60 - index}`,
      },
    }))
    const requestedTakes: number[] = []
    const selection = await new InitialContextSelectionService(
      new MessageCountTokenEstimator(),
    ).select({
      resolvedModel: 'deepseek-v4-flash',
      contextWindowTokens: 17_010,
      resolvedMaxOutputTokens: 100,
      candidateBatchSize: 50,
      candidateHardLimit: 1_000,
      currentUserMessage: { role: 'user', content: 'current' },
      tools: [],
      buildModelMessages: messages => messages,
      loadCandidates: ({ cursor, take }) => {
        requestedTakes.push(take)
        const start = cursor
          ? candidates.findIndex(candidate => candidate.id === cursor.id) + 1
          : 0
        return Promise.resolve(candidates.slice(start, start + take))
      },
      assertAvailable: () => {},
    })

    assert.deepEqual(requestedTakes, [50, 50])
    assert.equal(selection.historyMessages.length, 51)
    assert.equal(selection.historyMessages[0]?.content, 'history-10')
    assert.equal(selection.historyMessages.at(-1)?.content, 'history-60')
    assert.equal(selection.summary.historyCandidateCount, 60)
    assert.equal(selection.summary.historyIncludedCount, 51)
    assert.equal(selection.summary.historyExcludedCount, 9)
    assert.equal(selection.summary.excludedReason, 'budget')
  })

  it('mandatory context 超预算时在读取 History 前失败', async () => {
    let loadCount = 0
    const service = new InitialContextSelectionService(
      new FixedTokenEstimator(600),
    )

    await assert.rejects(
      service.select({
        resolvedModel: 'deepseek-v4-flash',
        contextWindowTokens: 17_000,
        resolvedMaxOutputTokens: 100,
        candidateBatchSize: 50,
        candidateHardLimit: 1_000,
        currentUserMessage: { role: 'user', content: 'current' },
        tools: [],
        buildModelMessages: messages => messages,
        loadCandidates: () => {
          loadCount += 1
          return Promise.resolve([])
        },
        assertAvailable: () => {},
      }),
      ContextBudgetExceededError,
    )
    assert.equal(loadCount, 0)
  })

  it('较新的完整 Message 放不下时停止，不跳过它选择更旧小消息', async () => {
    let loadCount = 0
    const candidates = [
      createCandidate('new-large', 'x'.repeat(200), 2),
      createCandidate('old-small', 'x', 1),
    ]
    const selection = await new InitialContextSelectionService(
      new CharacterTokenEstimator(),
    ).select({
      resolvedModel: 'deepseek-v4-flash',
      contextWindowTokens: 16_500,
      resolvedMaxOutputTokens: 100,
      candidateBatchSize: 50,
      candidateHardLimit: 1_000,
      currentUserMessage: { role: 'user', content: 'current' },
      tools: [],
      buildModelMessages: messages => messages,
      loadCandidates: () => {
        loadCount += 1
        return Promise.resolve(candidates)
      },
      assertAvailable: () => {},
    })

    assert.equal(loadCount, 1)
    assert.deepEqual(selection.historyMessages, [])
    assert.equal(selection.summary.historyExcludedCount, 2)
    assert.equal(selection.summary.excludedReason, 'budget')
  })

  it('达到 candidate hard limit 时停止并标记 candidate_cap', async () => {
    const candidates = Array.from(
      { length: 6 },
      (_, index) => createCandidate(`message-${6 - index}`, 'x', 6 - index),
    )
    const takes: number[] = []
    const selection = await new InitialContextSelectionService(
      new CharacterTokenEstimator(),
    ).select({
      resolvedModel: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      resolvedMaxOutputTokens: 65_536,
      candidateBatchSize: 2,
      candidateHardLimit: 4,
      currentUserMessage: { role: 'user', content: 'current' },
      tools: [],
      buildModelMessages: messages => messages,
      loadCandidates: ({ cursor, take }) => {
        takes.push(take)
        const start = cursor
          ? candidates.findIndex(candidate => candidate.id === cursor.id) + 1
          : 0

        return Promise.resolve(candidates.slice(start, start + take))
      },
      assertAvailable: () => {},
    })

    assert.deepEqual(takes, [2, 2])
    assert.equal(selection.historyMessages.length, 4)
    assert.equal(selection.summary.historyCandidateCount, 4)
    assert.equal(selection.summary.excludedReason, 'candidate_cap')
  })

  it('较小 model window 或较大 output reserve 会选择更少 History', async () => {
    const candidates = Array.from(
      { length: 20 },
      (_, index) => createCandidate(
        `message-${20 - index}`,
        'x'.repeat(10),
        20 - index,
      ),
    )
    const select = (
      contextWindowTokens: number,
      resolvedMaxOutputTokens: number,
    ) => new InitialContextSelectionService(
      new CharacterTokenEstimator(),
    ).select({
      resolvedModel: 'deepseek-v4-flash',
      contextWindowTokens,
      resolvedMaxOutputTokens,
      candidateBatchSize: 50,
      candidateHardLimit: 1_000,
      currentUserMessage: { role: 'user', content: 'current' },
      tools: [],
      buildModelMessages: messages => messages,
      loadCandidates: () => Promise.resolve(candidates),
      assertAvailable: () => {},
    })

    const [smallModel, largeModel, largerOutput] = await Promise.all([
      select(16_550, 100),
      select(16_800, 100),
      select(16_800, 300),
    ])

    assert.ok(
      smallModel.summary.historyIncludedCount
      < largeModel.summary.historyIncludedCount,
    )
    assert.ok(
      largerOutput.summary.historyIncludedCount
      < largeModel.summary.historyIncludedCount,
    )
  })
})

class MessageCountTokenEstimator extends TokenEstimator {
  readonly strategyId = 'test-message-count'

  estimateInitialRequest(input: TokenEstimatorInput): number {
    return input.messages.length * 10
  }
}

class FixedTokenEstimator extends TokenEstimator {
  readonly strategyId = 'test-fixed'

  constructor(private readonly tokens: number) {
    super()
  }

  estimateInitialRequest(_input: TokenEstimatorInput): number {
    return this.tokens
  }
}

class CharacterTokenEstimator extends TokenEstimator {
  readonly strategyId = 'test-character-count'

  estimateInitialRequest(input: TokenEstimatorInput): number {
    return input.messages.reduce(
      (total, message) => total + message.content.length + 1,
      input.tools.length,
    )
  }
}

function createCandidate(
  id: string,
  content: string,
  timestamp: number,
) {
  return {
    id,
    createdAt: new Date(timestamp),
    message: { role: 'user' as const, content },
  }
}
