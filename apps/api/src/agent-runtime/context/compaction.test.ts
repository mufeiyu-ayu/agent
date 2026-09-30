import type { ModelInputItem } from '@agent/ai'
import type { ConversationHistory, HistoryGroup } from './conversation-history.js'
import type { ModelContextToolExchange } from './model-context.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import {
  historySummaryChunks,
  keepRecentBudget,
  planHistoryCompaction,
  planTurnCompaction,
  serializeGroup,
  serializeTurnPrefix,
  SUMMARIZATION_SYSTEM_PROMPT,
  summaryRequestText,
} from './compaction.js'
import { groupItems, turnSummaryMessage } from './conversation-history.js'
import { estimateItemTokens } from './token-estimate.js'

/** 一次问答：问题 + 回答，回答正文每 4 个 ASCII 字符约 1 token，便于按粗估构造大小。 */
function group(key: string, answerChars: number, options: Partial<HistoryGroup> = {}): HistoryGroup {
  const answer: ModelInputItem[] = [{ type: 'message', role: 'assistant', content: 'a'.repeat(answerChars) }]

  return {
    key,
    messageCount: 2,
    summarizable: true,
    answered: true,
    question: { content: `问题 ${key}`, createdAt: new Date('2026-09-29T16:30:00.000Z') },
    answer,
    answerOnly: answer,
    ...options,
  }
}

function history(groups: HistoryGroup[], compaction?: ConversationHistory['compaction']): ConversationHistory {
  return { readAt: new Date('2026-09-30T00:00:00.000Z'), compaction, groups }
}

function tokens(item: HistoryGroup, answerOnly = false): number {
  return groupItems(item, answerOnly).reduce((sum, value) => sum + estimateItemTokens(value), 0)
}

function exchange(attempt: number, observationChars: number): ModelContextToolExchange {
  return {
    samplingAttemptId: `run-1:sampling-${attempt}`,
    assistantCall: {
      type: 'assistant_tool_call',
      calls: [{ callId: `call-${attempt}`, name: 'web_fetch', rawArgumentsJson: `{"url":"https://example.com/${attempt}"}` }],
      reasoningContent: `思考 ${attempt}`,
    },
    results: [{ type: 'tool_result', callId: `call-${attempt}`, name: 'web_fetch', content: 'x'.repeat(observationChars), ok: true }],
  }
}

describe('历史压缩的范围与切点（#220 AC-02）', () => {
  it('保留预算取 min(配置, 触发线的 1/4)，配置不小于触发线时也按 1/4', () => {
    assert.equal(keepRecentBudget(20_000, 262_144), 20_000)
    assert.equal(keepRecentBudget(20_000, 60_000), 15_000)
    assert.equal(keepRecentBudget(200_000, 100_000), 25_000)
  })

  it('从最新的可摘要组往回整组累加，放得下就保留；更早的全部进摘要；进行中的组不参与', () => {
    const groups = [group('u1', 400), group('u2', 400), group('u3', 400, { summarizable: false }), group('u4', 400), group('u5', 400)]
    // 刚好放得下最新两组可摘要的（u4、u5），进行中的 u3 不计入也不进摘要。
    const plan = planHistoryCompaction(history(groups), tokens(groups[3]!) + tokens(groups[4]!))

    assert.deepEqual(plan?.groups.map(item => item.key), ['u1', 'u2'])
  })

  it('边界组：退回形式放得下就以退回形式保留（完整内容进摘要、不进覆盖集合），否则整组进摘要', () => {
    const boundary = group('u2', 4_000, { answerOnly: [{ type: 'message', role: 'assistant', content: 'short' }] })
    const newest = group('u3', 400)
    const groups = [group('u1', 400), boundary, newest]
    const room = tokens(newest) + tokens(boundary, true)

    const fits = planHistoryCompaction(history(groups), room)
    const tooSmall = planHistoryCompaction(history(groups), room - 1)

    assert.deepEqual([fits?.groups.map(item => item.key), fits?.answerOnlyGroupKey], [['u1', 'u2'], 'u2'])
    assert.deepEqual([tooSmall?.groups.map(item => item.key), tooSmall?.answerOnlyGroupKey], [['u1', 'u2'], undefined])

    const [chunk] = historySummaryChunks(history(groups), fits!, 1_000_000)

    assert.deepEqual([chunk?.coveredGroupIds, chunk?.answerOnlyGroupId], [['u1'], 'u2'])
    // 边界组按完整形态进摘要。
    assert.match(chunk!.conversation, /\[Assistant\]: a{4000}/)
  })

  it('做过本轮压缩的组、上次的边界组都按它们在历史里的样子计量', () => {
    const turnCompacted = group('u2', 0, {
      answer: [turnSummaryMessage('前缀摘要'), { type: 'message', role: 'assistant', content: 'b'.repeat(400) }],
      answerOnly: [{ type: 'message', role: 'assistant', content: 'b'.repeat(8_000) }],
    })
    // 上次的边界组 u1 按退回形式出现，它就是最旧的候选。
    const previous = { id: 'c-1', summary: '旧摘要', coveredGroupIds: ['u0'], answerOnlyGroupId: 'u1' }
    const oldBoundary = group('u1', 4_000, { answerOnly: [{ type: 'message', role: 'assistant', content: 'short' }] })
    const view = history([oldBoundary, turnCompacted], previous)

    // 两组都按当前样子放得下：没有新的可摘要组，不压。
    assert.equal(planHistoryCompaction(view, tokens(oldBoundary, true) + tokens(turnCompacted)), undefined)
    // 再小一点：旧边界组进摘要（按退回形式序列化），不再作为边界组保留。
    const plan = planHistoryCompaction(view, tokens(turnCompacted))
    const [chunk] = historySummaryChunks(view, plan!, 1_000_000)

    assert.deepEqual([plan?.groups.map(item => item.key), plan?.answerOnlyGroupKey], [['u1'], undefined])
    assert.deepEqual([chunk?.coveredGroupIds, chunk?.answerOnlyGroupId], [['u0', 'u1'], null])
    assert.match(chunk!.conversation, /\[Assistant\]: short$/)
  })

  it('没有新的可摘要组时不压缩：全部放得下，或只剩进行中的组', () => {
    assert.equal(planHistoryCompaction(history([group('u1', 400), group('u2', 400)]), 100_000), undefined)
    assert.equal(planHistoryCompaction(history([group('u1', 40_000, { summarizable: false })]), 10), undefined)
    assert.equal(planHistoryCompaction(history([]), 10), undefined)
  })

  it('摘要输入超过触发线一半时按整组分块：每块一条记录、覆盖集合逐块累计，单组超出时自成一块，边界组只在最后一块', () => {
    const groups = [group('u1', 6_000), group('u2', 6_000), group('u3', 9_000), group('u4', 1_000), group('u5', 100)]
    const view = history(groups, { id: 'c-0', summary: '旧摘要', coveredGroupIds: ['u0'], answerOnlyGroupId: null })
    const plan = { groups: groups.slice(0, 4), answerOnlyGroupKey: 'u4' }
    // 触发线 4,000 → 块预算 2,000：u1+u2 合起来超出，各自成块；u3 单独超出也自成一块。
    const chunks = historySummaryChunks(view, plan, 4_000)

    assert.deepEqual(chunks.map(chunk => [chunk.coveredGroupIds, chunk.answerOnlyGroupId]), [
      [['u0', 'u1'], null],
      [['u0', 'u1', 'u2'], null],
      [['u0', 'u1', 'u2', 'u3'], null],
      [['u0', 'u1', 'u2', 'u3'], 'u4'],
    ])
    assert.equal(chunks.map(chunk => chunk.conversation).join('\n\n').includes('[User] (2026-09-30): 问题 u5'), false)
  })
})

describe('本轮压缩的切点（#220 AC-03）', () => {
  it('从最新的工具轮往回累加，放得下就保留，只切在某一轮开头，返回第一条保留的工具轮', () => {
    const exchanges = [exchange(1, 400), exchange(2, 400), exchange(3, 400), exchange(4, 400)]
    const perExchange = estimateItemTokens(exchanges[0]!.assistantCall) + estimateItemTokens(exchanges[0]!.results[0]!)

    assert.equal(planTurnCompaction(exchanges, 0, perExchange * 2), 2)
    assert.equal(planTurnCompaction(exchanges, 0, perExchange * 2 + perExchange - 1), 2)
  })

  it('最少保留最新一轮：最新一轮单独超出保留预算时也保留它', () => {
    assert.equal(planTurnCompaction([exchange(1, 400), exchange(2, 40_000)], 0, 10), 1)
    assert.equal(planTurnCompaction([exchange(1, 400), exchange(2, 400)], 0, 0), 1)
  })

  it('前缀为空时没有可压缩的内容：只有一轮，或新切点不比上次保留的起点更靠后', () => {
    assert.equal(planTurnCompaction([exchange(1, 400)], 0, 0), undefined)
    assert.equal(planTurnCompaction([], 0, 0), undefined)
    // 上次从第 3 轮起保留；这次只新增了一轮、全部放得下：切点还是 2（第 3 轮），没有新内容。
    assert.equal(planTurnCompaction([exchange(1, 400), exchange(2, 400), exchange(3, 400), exchange(4, 400)], 2, 1_000_000), undefined)
    // 预算紧时切点移到最新一轮：比上次靠后，UPDATE 合并第 3 轮。
    assert.equal(planTurnCompaction([exchange(1, 400), exchange(2, 400), exchange(3, 400), exchange(4, 400)], 2, 0), 3)
  })
})

describe('摘要请求的序列化与拼接（#220 AC-04）', () => {
  it('问题带北京日期（用户消息创建时），没有回答的标 unanswered；各段以空行分隔，照 Pi 的角色标签', () => {
    const answered = group('u1', 0, {
      question: { content: '怎么查？', createdAt: new Date('2026-09-29T16:30:00.000Z') },
      answer: [
        {
          type: 'assistant_tool_call',
          calls: [
            { callId: 'c1', name: 'web_search', rawArgumentsJson: '{"query":"a \\"b\\"","limit":3}' },
            { callId: 'c2', name: 'web_fetch', rawArgumentsJson: JSON.stringify({ arguments: '{"url": "htt' }) },
          ],
          reasoningContent: '',
          content: '先查。',
        },
        { type: 'tool_result', callId: 'c1', name: 'web_search', content: '结果', ok: true },
        { type: 'tool_result', callId: 'c2', name: 'web_fetch', content: '', ok: false },
        { type: 'message', role: 'assistant', content: '答案。' },
      ],
    })
    const unanswered = group('u2', 0, { answered: false, answer: [], answerOnly: [] })

    assert.equal(serializeGroup(answered, false), [
      '[User] (2026-09-30): 怎么查？',
      '[Assistant]: 先查。',
      '[Assistant tool calls]: web_search(query="a \\"b\\"", limit=3); web_fetch(arguments="{\\"url\\": \\"htt")',
      '[Tool result]: 结果',
      '[Assistant]: 答案。',
    ].join('\n\n'))
    assert.equal(serializeGroup(unanswered, false), '[User] (2026-09-30, unanswered): 问题 u2')
  })

  it('本轮前缀带当前问题与本 Run 的思考；工具结果超过 2,000 字符截断并标出截掉的字符数，参数不截断', () => {
    // 按 JS 字符串长度截（照 Pi），落在代理对中间也照截。
    const long = `${'正'.repeat(1_999)}😀尾`
    const first = exchange(1, 0)
    const text = serializeTurnPrefix({
      question: { content: '当前问题', createdAt: new Date('2026-09-30T01:00:00.000Z') },
      exchanges: [{ ...first, results: [{ ...first.results[0]!, content: long }] }],
    })

    assert.equal(text, [
      '[User] (2026-09-30): 当前问题',
      '[Assistant thinking]: 思考 1',
      '[Assistant tool calls]: web_fetch(url="https://example.com/1")',
      `[Tool result]: ${long.slice(0, 2_000)}\n\n[... ${long.length - 2_000} more characters truncated]`,
    ].join('\n\n'))
    // UPDATE 时不再带问题。
    assert.match(serializeTurnPrefix({ question: undefined, exchanges: [exchange(2, 10)] }), /^\[Assistant thinking\]: 思考 2/)
  })

  it('请求文本：<conversation> 包对话，有旧摘要时放 <previous-summary> 并用 UPDATE 提示词，首次按层选提示词', () => {
    const first = summaryRequestText({ kind: 'history', conversation: 'CONV', previousSummary: undefined })
    const update = summaryRequestText({ kind: 'history', conversation: 'CONV', previousSummary: 'OLD' })
    const prefix = summaryRequestText({ kind: 'turn_prefix', conversation: 'CONV', previousSummary: undefined })
    const prefixUpdate = summaryRequestText({ kind: 'turn_prefix', conversation: 'CONV', previousSummary: 'OLD' })

    assert.match(first, /^<conversation>\nCONV\n<\/conversation>\n\nThe messages above are a conversation to summarize\./)
    assert.match(update, /^<conversation>\nCONV\n<\/conversation>\n\n<previous-summary>\nOLD\n<\/previous-summary>\n\nThe messages above are NEW conversation messages/)
    assert.match(prefix, /^<conversation>\nCONV\n<\/conversation>\n\nThis is the PREFIX of a turn that was too large to keep\./)
    assert.equal(prefixUpdate, update)
    assert.match(SUMMARIZATION_SYSTEM_PROMPT, /^You are a context summarization assistant\./)
  })

  it('提示词带上附录里我们加的几条：Sources、原样保留 URL / 数字 / 日期、修改要求不丢、未回答不进行中、用用户的语言', () => {
    const first = summaryRequestText({ kind: 'history', conversation: '', previousSummary: undefined })
    const update = summaryRequestText({ kind: 'history', conversation: '', previousSummary: '' })
    const prefix = summaryRequestText({ kind: 'turn_prefix', conversation: '', previousSummary: undefined })

    for (const text of [first, update]) {
      assert.match(text, /\n## Sources\n/)
      assert.match(text, /Also preserve exact URLs, numbers and dates\./)
      assert.match(text, /Questions marked \(unanswered\) were abandoned; do not list them under In Progress or Next Steps\./)
      assert.match(text, /Record every change request and every rejected approach from the user under Constraints & Preferences, and never drop them\./)
      assert.match(text, /Write the summary in the language the user writes in\.$/)
    }
    assert.match(update, /- The new messages are more recent than the previous summary\. Where they conflict, the new messages win: state the corrected fact and drop the old claim\./)
    assert.match(prefix, /\n## Sources\n- \[<URL> — <page title or what it was used for>\]\n- \[Or "\(none\)"\]\n\nBe concise\./)
    assert.match(prefix, /Preserve exact URLs, numbers and dates\.\nWrite the summary in the language the user writes in\.$/)
  })
})
