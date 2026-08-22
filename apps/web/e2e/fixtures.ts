import type { ConversationMessage, MessageCitationV1, MessageGroundingV1 } from '@agent/contracts'
import type { Page } from '@playwright/test'

/**
 * Issue #60 浏览器验收使用的确定性 fixture。
 *
 * 所有 API 都由 `page.route()` 与一个受控的 `fetch` 包装提供，测试完全不依赖 API 进程、
 * 数据库或模型 Provider 的随机输出。
 */

export const CONVERSATION_ID = 'conversation-1'

export function createCitation(
  overrides: Partial<MessageCitationV1> = {},
): MessageCitationV1 {
  return {
    citationId: 'cit_0123456789abcdef0123456789abcdef',
    sourceId: 301,
    chunkId: 'article-301-chunk-0',
    granularity: 'chunk',
    title: '落地页 SEO 结构指南',
    slug: 'landing-page-seo',
    languageCode: 'zh-cn',
    sectionPath: '页面结构 / 标题层级',
    excerpt: 'H1 应当唯一，并与 title 表达同一个搜索意图。',
    rank: 1,
    href: null,
    strategy: { name: 'hybrid_rrf', version: '1' },
    ...overrides,
  }
}

/** answered + available：一条 chunk 粒度、一条没有 excerpt 的 article 粒度。 */
export const ANSWERED_GROUNDING: MessageGroundingV1 = {
  schemaVersion: 1,
  evidenceAvailability: 'available',
  outcome: 'answered',
  citationIntegrity: 'validated',
  faithfulnessStatus: 'not_evaluated',
  citations: [
    createCitation(),
    createCitation({
      citationId: 'cit_ffffffffffffffffffffffffffffffff',
      sourceId: 302,
      chunkId: null,
      granularity: 'article',
      title: 'Keyword Intent Mapping',
      slug: 'keyword-intent-mapping',
      languageCode: 'en-us',
      sectionPath: null,
      excerpt: null,
      rank: 2,
    }),
  ],
}

/** insufficient + unavailable：检索能力不可用，没有任何来源。 */
export const UNAVAILABLE_GROUNDING: MessageGroundingV1 = {
  schemaVersion: 1,
  evidenceAvailability: 'unavailable',
  outcome: 'insufficient_evidence',
  citationIntegrity: 'validated',
  faithfulnessStatus: 'not_evaluated',
  citations: [],
}

/** 窄屏溢出验收使用的超长展示字段；导出供 spec 断言「完整可读」。 */
export const LONG_SOURCE_TEXT = {
  title: '面向多语言站点的落地页信息架构与关键词意图映射长标题压力测试用例标题标题标题标题标题',
  sectionPath: '内容策略 / 信息架构 / 关键词意图映射 / 长尾词分组 / 页面模板与内链结构设计',
  excerpt: '在多语言站点中，同一个关键词意图往往需要按地区拆分为不同落地页；'
    + '如果只用一套模板覆盖全部语言，标题层级、内链锚文本和结构化数据都会互相冲突，'
    + '导致搜索引擎难以判断每个页面的主要意图，最终稀释整体排名表现。',
} as const

const { title: LONG_TITLE, sectionPath: LONG_SECTION_PATH, excerpt: LONG_EXCERPT } = LONG_SOURCE_TEXT

/**
 * answered + available：长内容，用于窄屏 answered 布局验收。
 *
 * 与 `CONFLICTING_GROUNDING` 刻意分开：窄屏 answered 与窄屏非成功状态是两个
 * 独立场景，合并成一个会丢掉其中一边的覆盖。
 */
export const ANSWERED_LONG_GROUNDING: MessageGroundingV1 = {
  schemaVersion: 1,
  evidenceAvailability: 'available',
  outcome: 'answered',
  citationIntegrity: 'validated',
  faithfulnessStatus: 'not_evaluated',
  citations: [
    createCitation({
      title: LONG_TITLE,
      sectionPath: LONG_SECTION_PATH,
      excerpt: LONG_EXCERPT,
    }),
    createCitation({
      citationId: 'cit_11111111222222223333333344444444',
      sourceId: 304,
      chunkId: null,
      granularity: 'article',
      title: 'Locale-aware landing page templates',
      slug: 'locale-aware-templates',
      languageCode: 'en-us',
      sectionPath: null,
      excerpt: null,
      rank: 2,
    }),
  ],
}

/** conflicting + partial：长内容，用于窄屏溢出验收。 */
export const CONFLICTING_GROUNDING: MessageGroundingV1 = {
  schemaVersion: 1,
  evidenceAvailability: 'partial',
  outcome: 'conflicting_evidence',
  citationIntegrity: 'validated',
  faithfulnessStatus: 'not_evaluated',
  citations: [
    createCitation({
      title: LONG_TITLE,
      sectionPath: LONG_SECTION_PATH,
      excerpt: LONG_EXCERPT,
    }),
    createCitation({
      citationId: 'cit_abcdefabcdefabcdefabcdefabcdefab',
      sourceId: 303,
      chunkId: 'article-303-chunk-4',
      title: 'Single-template multilingual landing pages',
      slug: 'single-template-multilingual',
      languageCode: 'en-us',
      sectionPath: 'Architecture / Templates',
      excerpt: 'A single shared template keeps intent signals consistent across locales.',
      rank: 2,
    }),
  ],
}

export function createUserMessage(
  id: string,
  content: string,
  createdAt: string,
): ConversationMessage {
  return {
    id,
    conversationId: CONVERSATION_ID,
    role: 'USER',
    content,
    status: 'COMPLETED',
    createdAt,
    updatedAt: createdAt,
    grounding: null,
  }
}

export function createAssistantMessage(
  id: string,
  content: string,
  createdAt: string,
  grounding: unknown = null,
): ConversationMessage {
  return {
    id,
    conversationId: CONVERSATION_ID,
    role: 'ASSISTANT',
    content,
    status: 'COMPLETED',
    createdAt,
    updatedAt: createdAt,
    grounding: grounding as MessageGroundingV1 | null,
  }
}

export function toNdjsonLines(grounding?: MessageGroundingV1): string[] {
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
      ...(grounding ? { grounding } : {}),
    }),
  ]
}

export function toTerminalNdjsonLines(
  terminal: 'error' | 'aborted',
): string[] {
  const [start, firstDelta] = toNdjsonLines()

  return [
    start,
    firstDelta,
    terminal === 'error'
      ? JSON.stringify({
          type: 'error',
          conversationId: CONVERSATION_ID,
          assistantMessageId: 'assistant-live',
          message: '模型服务暂时不可用',
        })
      : JSON.stringify({
          type: 'aborted',
          conversationId: CONVERSATION_ID,
          assistantMessageId: 'assistant-live',
          content: '先确认 H1 与 title 是否表达同一个意图，',
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
    __seoRequests?: unknown[]
  }
}

/**
 * 安装浏览器侧的确定性桩。
 *
 * - `/api/seo/chat/stream` 由受控 `ReadableStream` 逐行推送，可在 `done` 之前挂起，
 *   这样 streaming 中间态是可断言的，而不是靠时序碰运气；
 * - `navigator.clipboard.writeText` 被记录下来，用于验证复制内容只含回答正文；
 * - 语言写入 localStorage，避免受运行环境的 `navigator.language` 影响。
 */
export async function installBrowserStubs(
  page: Page,
  plan: StreamPlan,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) {
  await page.addInitScript(
    ({ plan: streamPlan, locale: appLocale }) => {
      window.localStorage.setItem('agent-web-locale', appLocale)

      const originalFetch = window.fetch.bind(window)
      window.__seoRequests = []
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

        if (!url.includes('/api/seo/chat/stream'))
          return originalFetch(input, init)

        window.__seoRequests?.push(JSON.parse(String(init?.body)))

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
    { plan, locale },
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

  await page.route('**/api/llm/models', route => route.fulfill(json({
    object: 'list',
    data: [{ id: 'deepseek-v4-flash', object: 'model', owned_by: 'deepseek' }],
  })))

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
