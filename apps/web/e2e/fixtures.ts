import type { ConversationMessage } from '@agent/contracts'
import type { Page } from '@playwright/test'

/**
 * Issue #60 浏览器验收使用的确定性 fixture。
 *
 * 所有 API 都由 `page.route()` 与一个受控的 `fetch` 包装提供，测试完全不依赖 API 进程、
 * 数据库或模型 Provider 的随机输出。
 */

export const CONVERSATION_ID = 'conversation-1'

export function toNdjsonLines(): string[] {
  return [
    JSON.stringify({
      type: 'start',
      conversationId: CONVERSATION_ID,
      userMessageId: 'user-live',
      assistantMessageId: 'assistant-live',
    }),
    JSON.stringify({
      type: 'delta',
      conversationId: CONVERSATION_ID,
      assistantMessageId: 'assistant-live',
      contentDelta: '先确认 H1 与 title 是否表达同一个意图，',
    }),
    JSON.stringify({
      type: 'delta',
      conversationId: CONVERSATION_ID,
      assistantMessageId: 'assistant-live',
      contentDelta: '再检查内链锚文本。',
    }),
    JSON.stringify({
      type: 'done',
      conversationId: CONVERSATION_ID,
      assistantMessageId: 'assistant-live',
      content: '先确认 H1 与 title 是否表达同一个意图，再检查内链锚文本。',
      generatedAt: '2026-08-16T09:00:00.000Z',
    }),
  ]
}

export interface StreamPlan {
  lines: string[]
  /** 在推送这一行之前挂起，等待测试显式放行；`-1` 表示不挂起。 */
  holdBeforeIndex: number
}

declare global {
  interface Window {
    __releaseStream?: () => void
    __copiedText?: string
    __chatRequests?: unknown[]
  }
}

/**
 * 安装浏览器侧的确定性桩。
 *
 * - `/api/chat/stream` 由受控 `ReadableStream` 逐行推送，可在 `done` 之前挂起，
 *   这样 streaming 中间态是可断言的，而不是靠时序碰运气；
 * - `navigator.clipboard.writeText` 被记录下来，用于验证复制内容只含回答正文；
 * - 语言写入 localStorage，避免受运行环境的 `navigator.language` 影响。
 */
export async function installBrowserStubs(
  page: Page,
  plan: StreamPlan,
) {
  await page.addInitScript(
    ({ plan: streamPlan }) => {
      window.localStorage.setItem('agent-web-locale', 'zh-CN')

      const originalFetch = window.fetch.bind(window)
      window.__chatRequests = []
      let release: (() => void) | undefined
      // 记录「已放行」而不是只保存 resolver：测试可能在流到达挂起点之前就调用放行，
      // 只保存 resolver 会让这次放行丢失，流永远挂住。
      let isReleased = false

      window.__releaseStream = () => {
        isReleased = true
        release?.()
      }

      window.fetch = async (input, init) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL ? input.href : input.url

        if (!url.includes('/api/chat/stream'))
          return originalFetch(input, init)

        window.__chatRequests?.push(JSON.parse(String(init?.body)))

        const encoder = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const [index, line] of streamPlan.lines.entries()) {
              if (index === streamPlan.holdBeforeIndex && !isReleased) {
                await new Promise<void>((resolve) => {
                  release = resolve
                })
              }

              controller.enqueue(encoder.encode(`${line}\n`))
              await new Promise(resolve => setTimeout(resolve, 20))
            }

            controller.close()
          },
        })

        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
      }

      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            window.__copiedText = text
          },
        },
      })
    },
    { plan },
  )
}

/** 用固定 JSON 响应桩住其余 REST 接口。 */
export async function installApiRoutes(
  page: Page,
  getMessages: () => ConversationMessage[],
) {
  const json = (data: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, code: 0, message: 'ok', data }),
  })

  // 与 `/api/llm/models` 的 ChatModelOption[] 契约对齐（#142 起）：三档强度、默认 High。
  await page.route('**/api/llm/models', route => route.fulfill(json([{
    id: 'model-deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash',
    reasoningEffort: 'high',
    reasoningEffortOptions: ['low', 'high', 'max'],
    isDefault: true,
  }])))

  await page.route('**/api/llm/balance', route => route.fulfill(json({
    is_available: true,
    balance_infos: [{
      currency: 'CNY',
      total_balance: '100.00',
      granted_balance: '0.00',
      topped_up_balance: '100.00',
    }],
  })))

  await page.route(`**/api/conversations/${CONVERSATION_ID}/messages`, route => route.fulfill(
    json(getMessages()),
  ))

  await page.route('**/api/conversations?*', route => route.fulfill(json({
    items: [{
      id: CONVERSATION_ID,
      title: '落地页 SEO 诊断',
      createdAt: '2026-08-16T08:00:00.000Z',
      updatedAt: '2026-08-16T09:00:00.000Z',
    }],
    nextCursor: null,
  })))
}
