import type {
  ApiErrorResponse,
  ChatRequest,
  ChatStreamEvent,
  Conversation,
  ConversationMessage,
  ReasoningEffort,
} from '@agent/contracts'
import type { AgentRecentChat } from '../types/agent-platform'
import type {
  AppMessageState,
  AppMessageType,
  ChatAttachment,
  ComposerAttachment,
  GenerationStatus,
  TurnRun,
} from '../types/chat'

import { isAxiosError } from 'axios'
import { computed, onMounted, onUnmounted, ref, shallowReactive, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { attachmentContentUrl } from '../api/attachments'
import { ChatStreamHttpError, streamChat } from '../api/chat'
import {
  createConversation,
  deleteConversation,
  listConversationMessages,
  listConversations,
  updateConversation,
} from '../api/conversations'
import {
  compareMessagesByCreatedAt,
  mapMessagesToConversationTurns,
  restoreMessageRun,
  sortConversationsByUpdatedAt,
} from '../utils/conversation-turns'
import { applyRunEvent, endRun, startRun } from '../utils/run-status'

const CHAT_REQUEST_INTERVAL_MS = 800
const DEFAULT_MESSAGE_TIMEOUT_MS = 3600
const ERROR_MESSAGE_TIMEOUT_MS = 6400
const CONVERSATION_PAGE_SIZE = 20
const CONVERSATION_TITLE_MAX_LENGTH = 28
const REASONING_FLUSH_MS = 200

/** 工作区里一次请求独占的状态；空白视图先用本地 key，创建成功后绑定会话 id。 */
interface ChatRequestState {
  key: string
  requestId: string
  conversationId: string | null
  controller: AbortController
  requestedAt: number
  active: boolean
  status: GenerationStatus
  error: string
  turnId: string | null
  assistantMessageId: string | null
  pendingDelta: Extract<ChatStreamEvent, { type: 'delta' }> | null
  deltaFrame?: number
  pendingReasoning: Extract<ChatStreamEvent, { type: 'reasoning_delta' }> | null
  reasoningTimer?: number
}

interface UseChatWorkspaceOptions {
  /** 发送因模型行不可用被拒（HTTP 400）：由调用方重新拉取模型列表并纠正选中项。 */
  onModelUnavailable?: () => void
  /** 只在后端确认删除后清理关联工作文件缓存。 */
  onConversationDeleted?: (conversationId: string) => void
}

export function useChatWorkspace(options: UseChatWorkspaceOptions = {}) {
  const { t } = useI18n()
  const message = ref('')
  // 输入框里待发送的附件：增删由 useComposerAttachments 负责，这里只在发送与切会话时清。
  const attachments = ref<ComposerAttachment[]>([])
  const conversations = ref<Conversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const messages = ref<ConversationMessage[]>([])
  const loadingConversationList = ref(false)
  const isLoadingMoreConversations = ref(false)
  const isLoadingMessages = ref(false)
  const isHistoryReady = ref(true)
  const shouldAnchorLatestTurn = ref(false)
  const hasMoreConversations = ref(false)
  const conversationError = ref('')
  const mutatingConversations = shallowReactive(new Map<string, 'rename' | 'delete'>())
  const isLoadingConversations = computed(() => loadingConversationList.value || [...mutatingConversations.values()].includes('delete'))
  const localTurnErrors = ref<Record<string, string>>({})
  // 每轮的等待过程（#208），按助手消息 id 存在页面内存里；刷新后由消息的 activity 还原（#212）。
  const turnRuns = shallowRef<Record<string, TurnRun>>({})
  // 这次页面里发出的附件按用户消息 id 留着本地地址：图片不用再从后端下载一遍。其余消息的附件来自接口。
  const turnAttachments = shallowRef<Record<string, ChatAttachment[]>>({})
  // 接口附件的映射结果按消息对象记住，理由同 restoredRuns：历史轮次要保持同一个数组，v-memo 才不失效。
  const fetchedAttachments = new WeakMap<ConversationMessage, ChatAttachment[]>()
  // 还原结果按消息对象记住：流式时每帧都会重算全部轮次，历史轮次的 run 要保持同一个对象，
  // 否则 AgentConversation 的 v-memo 失效、每帧重渲染所有历史轮次。消息更新时换成新对象，自然重新还原。
  const restoredRuns = new WeakMap<ConversationMessage, TurnRun | undefined>()
  const appMessage = ref<AppMessageState>({
    visible: false,
    type: 'info',
    text: '',
  })

  let messageTimer: number | undefined
  let messageLoadRunId = 0
  let conversationNextCursor: string | null = null
  let isUnmounted = false
  let initialSelectionAllowed = true
  const newConversationKey = ref(createClientMessageId())
  // 每个会话只留最后一次请求，终态也保留，切回时可还原控件；旧回调只能更新自己。
  const requests = shallowReactive(new Map<string, ChatRequestState>())
  const currentViewKey = computed(() => activeConversationId.value ?? newConversationKey.value)
  const currentRequest = computed(() => requests.get(currentViewKey.value))
  const status = computed(() => currentRequest.value?.status ?? getSettledWorkspaceStatus())
  const errorMessage = computed(() => currentRequest.value?.error ?? '')
  const conversationMessagesCache = new Map<string, ConversationMessage[]>()
  // 每次本地消息变更（流事件、乐观更新）都会推进版本号；消息加载用它
  // 识别「fetch 期间本地已被流终态更新」的过期快照。
  const conversationMessagesVersion = new Map<string, number>()

  const messageCharacterCount = computed(() => message.value.length)

  const conversationTurns = computed(() => {
    return mapMessagesToConversationTurns(messages.value, {
      activeTurnId: currentRequest.value?.active ? currentRequest.value.turnId : null,
      turnErrors: localTurnErrors.value,
      runs: turnRuns.value,
      attachmentsOf,
      restoredRun: restoredRunOf,
    })
  })

  const recentChats = computed<AgentRecentChat[]>(() => {
    return conversations.value.map(conversation => ({
      id: conversation.id,
      title: conversation.title,
      active: conversation.id === activeConversationId.value,
      running: requests.get(conversation.id)?.active ?? false,
      pending: mutatingConversations.has(conversation.id),
    }))
  })

  onMounted(() => {
    void initializeWorkspace()
  })

  onUnmounted(() => {
    // 与 stopGeneration 语义一致：离开工作区即中止进行中的流，
    // 不做跨页面恢复；同时清理提示消息定时器。isUnmounted 阻止
    // abort 之后才落地的异步续体再更新状态或重建定时器。
    isUnmounted = true
    for (const request of requests.values()) {
      request.controller.abort()
      clearRequestBuffers(request)
    }

    if (messageTimer !== undefined)
      window.clearTimeout(messageTimer)
  })

  async function initializeWorkspace() {
    const initialView = currentViewKey.value
    await loadConversationList()
    if (isUnmounted || !initialSelectionAllowed || currentViewKey.value !== initialView)
      return

    const initialConversationId = conversations.value[0]?.id ?? null
    activeConversationId.value = initialConversationId

    if (initialConversationId) {
      await loadMessagesForConversation(initialConversationId)
      return
    }

    clearActiveMessages()
  }

  function resetWorkspace() {
    newConversationKey.value = createClientMessageId()
    activeConversationId.value = null
    clearActiveMessages()
    resetComposerState()
  }

  async function selectConversation(conversationId: string) {
    if (conversationId === activeConversationId.value)
      return

    shouldAnchorLatestTurn.value = false
    const request = requests.get(conversationId)
    // 消息数组此时仍属于上一视图，先按原选中身份刷入目标缓存，再切换展示。
    if (request?.active)
      flushPendingDelta(request)
    activeConversationId.value = conversationId
    applyCachedMessagesForConversation(conversationId)
    resetComposerState()
    await loadMessagesForConversation(conversationId)
  }

  async function deleteConversationById(conversationId: string) {
    // 保留原有生成中禁止删除的边界，包括当前没在看的请求。
    if (mutatingConversations.has(conversationId) || [...requests.values()].some(request => request.active))
      return

    mutatingConversations.set(conversationId, 'delete')
    try {
      conversationError.value = ''

      await deleteConversation(conversationId)
      // DELETE 在途时用户仍可能发送；删除成功后先取消期间启动的请求，不能丢掉其句柄。
      const request = requests.get(conversationId)
      if (request?.active) {
        request.controller.abort()
        clearRequestBuffers(request)
      }
      conversationMessagesCache.delete(conversationId)
      conversationMessagesVersion.delete(conversationId)
      requests.delete(conversationId)
      options.onConversationDeleted?.(conversationId)

      const nextConversations = conversations.value.filter(item => item.id !== conversationId)

      conversations.value = nextConversations

      if (activeConversationId.value !== conversationId)
        return

      const nextActiveConversationId = nextConversations[0]?.id ?? null

      activeConversationId.value = nextActiveConversationId
      shouldAnchorLatestTurn.value = false
      if (nextActiveConversationId)
        applyCachedMessagesForConversation(nextActiveConversationId)
      else
        clearActiveMessages()
      resetComposerState()

      if (nextActiveConversationId) {
        await loadMessagesForConversation(nextActiveConversationId)
      }
    }
    catch (error) {
      handleWorkspaceError(error)
    }
    finally {
      mutatingConversations.delete(conversationId)
    }
  }

  async function renameConversationById(conversationId: string, title: string) {
    const nextTitle = title.trim()

    if (!nextTitle || mutatingConversations.has(conversationId))
      return

    mutatingConversations.set(conversationId, 'rename')
    try {
      conversationError.value = ''

      const conversation = await updateConversation(conversationId, {
        title: nextTitle,
      })

      upsertConversation(conversation)
    }
    catch (error) {
      handleWorkspaceError(error)
    }
    finally {
      mutatingConversations.delete(conversationId)
    }
  }

  async function sendMessage(
    model?: string | null,
    reasoningEffort?: ReasoningEffort,
  ) {
    if (!canStartChatRequest())
      return

    initialSelectionAllowed = false
    const submittedMessage = message.value
    const messageContent = submittedMessage.trim()
    const submittedAttachments = attachments.value
    const submittedAttachmentIds = new Set(submittedAttachments.map(item => item.id))
    const attachmentIds = submittedAttachments.flatMap(item => item.remoteId ? [item.remoteId] : [])
    const sentAttachments = submittedAttachments.map(({ status: _status, progress: _progress, remoteId: _remoteId, ...attachment }) => attachment)
    const request = shallowReactive<ChatRequestState>({
      key: currentViewKey.value,
      requestId: createClientMessageId(),
      conversationId: activeConversationId.value,
      controller: new AbortController(),
      requestedAt: Date.now(),
      active: true,
      status: 'thinking',
      error: '',
      turnId: null,
      assistantMessageId: null,
      pendingDelta: null,
      pendingReasoning: null,
    })
    requests.set(request.key, request)
    attachments.value = attachments.value.map(item => submittedAttachmentIds.has(item.id) ? { ...item, locked: true } : item)
    shouldAnchorLatestTurn.value = true
    let pendingMessage: ConversationMessage | undefined

    try {
      if (!request.conversationId) {
        const conversation = await createConversation({
          // 只发附件时用第一个文件名当会话标题。
          title: createConversationTitle(messageContent || sentAttachments[0]?.name || ''),
        }, { signal: request.controller.signal })

        if (!ownsActiveRequest(request))
          return

        upsertConversation(conversation)
        const stillViewingOrigin = currentViewKey.value === request.key
        requests.delete(request.key)
        request.key = conversation.id
        request.conversationId = conversation.id
        requests.set(request.key, request)
        if (stillViewingOrigin)
          activeConversationId.value = conversation.id
      }

      const conversationId = request.conversationId
      const payload = buildChatRequest(conversationId, messageContent, attachmentIds, model, reasoningEffort)
      pendingMessage = createPendingUserMessage(conversationId, messageContent)
      request.turnId = pendingMessage.id
      if (sentAttachments.length > 0)
        turnAttachments.value = { ...turnAttachments.value, [pendingMessage.id]: sentAttachments }
      upsertMessageInConversation(pendingMessage)

      for await (const event of streamChat(payload, { signal: request.controller.signal })) {
        // stop、卸载或同会话新请求接管之后，迟到的 start/delta/终态都不再写入。
        if (!ownsActiveRequest(request))
          break
        if (event.conversationId !== conversationId)
          continue

        if (event.type === 'reasoning_delta') {
          handleStreamReasoningDeltaEvent(request, event)
          continue
        }

        flushPendingReasoning(request)

        if (event.type === 'delta') {
          updateTurnRun(event.assistantMessageId, run => applyRunEvent(run, event, performance.now()))
          handleStreamDeltaEvent(request, event)
          request.status = 'generating'
          continue
        }

        if (event.type === 'tool_started' || event.type === 'tool_finished') {
          updateTurnRun(event.assistantMessageId, run => applyRunEvent(run, event, performance.now()))
          continue
        }

        flushPendingDelta(request)

        if (event.type === 'start') {
          request.assistantMessageId = event.assistantMessageId
          request.turnId = event.userMessageId
          turnRuns.value = { ...turnRuns.value, [event.assistantMessageId]: startRun(performance.now()) }
          handleStreamStartEvent(event, pendingMessage)
          // 创建和 start 都可能在切走后到达，不抢选中会话，也不清掉另一视图的输入。
          if (currentViewKey.value === request.key && message.value === submittedMessage)
            message.value = ''
          if (sentAttachments.length > 0) {
            turnAttachments.value = { ...turnAttachments.value, [event.userMessageId]: sentAttachments }
            // 按本地 id 只拿走这次发出的；状态回填会换对象，不能用对象引用判断。
            attachments.value = attachments.value.filter(item => !submittedAttachmentIds.has(item.id))
          }
          request.status = 'generating'
          touchConversation(conversationId)
          continue
        }

        if (event.type === 'done') {
          endTurnRun(event.assistantMessageId, 'done')
          handleStreamDoneEvent(event)
          finishRequest(request, 'done')
          touchConversation(conversationId)
          break
        }

        if (event.type === 'error') {
          if (request.assistantMessageId)
            endTurnRun(request.assistantMessageId, 'error')
          request.error = event.message
          if (event.userMessagePersisted) {
            touchConversation(conversationId)
            // start 前的失败也可能已经提交，附件已被消费，不能留作再次绑定的重试。
            attachments.value = attachments.value.filter(item => !submittedAttachmentIds.has(item.id))
            if (currentViewKey.value === request.key && message.value === submittedMessage)
              message.value = ''
          }
          handleStreamErrorEvent(event, pendingMessage)
          finishRequest(request, 'error')
          if (currentViewKey.value === request.key)
            showMessage(event.message, 'error')
          break
        }

        endTurnRun(event.assistantMessageId, 'aborted')
        handleStreamAbortedEvent(event)
        finishRequest(request, 'aborted')
        break
      }

      if (ownsActiveRequest(request))
        throw new Error('流式响应提前结束，请稍后重试')
    }
    catch (error) {
      // 已有终态、被停止、卸载或同会话新请求接管时，尾部异常不能再改旧/新任务。
      if (!ownsActiveRequest(request))
        return

      flushPendingDelta(request)
      if (isAbortError(error)) {
        markGenerationAborted(request)
        return
      }

      if (request.assistantMessageId)
        endTurnRun(request.assistantMessageId, 'error')
      const nextErrorMessage = getRequestErrorMessage(error)
      request.error = nextErrorMessage
      if (request.assistantMessageId && request.conversationId) {
        setLocalTurnError(request.assistantMessageId, nextErrorMessage)
        markAssistantMessageFailed(request.conversationId, request.assistantMessageId, nextErrorMessage)
      }
      else if (pendingMessage) {
        setLocalTurnError(pendingMessage.id, nextErrorMessage)
      }
      finishRequest(request, 'error')
      if (currentViewKey.value === request.key) {
        if (error instanceof ChatStreamHttpError && error.isModelUnavailable)
          options.onModelUnavailable?.()
        showMessage(nextErrorMessage, 'error')
      }
    }
    finally {
      attachments.value = attachments.value.map(item => submittedAttachmentIds.has(item.id) ? { ...item, locked: false } : item)
      clearRequestBuffers(request)
    }
  }

  function ownsActiveRequest(request: ChatRequestState): boolean {
    return !isUnmounted && request.active && requests.get(request.key) === request
  }

  function finishRequest(request: ChatRequestState, nextStatus: GenerationStatus) {
    request.active = false
    request.turnId = null
    request.status = nextStatus
  }

  function clearRequestBuffers(request: ChatRequestState) {
    if (request.deltaFrame !== undefined)
      cancelAnimationFrame(request.deltaFrame)
    window.clearTimeout(request.reasoningTimer)
    request.deltaFrame = undefined
    request.reasoningTimer = undefined
    request.pendingDelta = null
    request.pendingReasoning = null
  }

  function attachmentsOf(message: ConversationMessage): ChatAttachment[] | undefined {
    const local = turnAttachments.value[message.id]
    if (local || !message.attachments?.length)
      return local

    let mapped = fetchedAttachments.get(message)
    if (!mapped) {
      mapped = message.attachments.map(attachment => ({
        ...attachment,
        url: attachmentContentUrl(attachment.id),
        ...(attachment.kind === 'image' ? { thumbUrl: attachmentContentUrl(attachment.id, 'thumb') } : {}),
      }))
      fetchedAttachments.set(message, mapped)
    }
    return mapped
  }

  function restoredRunOf(message: ConversationMessage): TurnRun | undefined {
    if (!restoredRuns.has(message))
      restoredRuns.set(message, restoreMessageRun(message))

    return restoredRuns.get(message)
  }

  /** 终态事件到达、本地停止或流异常时收尾本轮的等待过程：没等到 tool_finished 的步骤记为已停止。 */
  function endTurnRun(assistantMessageId: string, outcome: NonNullable<TurnRun['outcome']>) {
    updateTurnRun(assistantMessageId, run => endRun(run, performance.now(), outcome))
  }

  function updateTurnRun(assistantMessageId: string, update: (run: TurnRun) => TurnRun) {
    const run = turnRuns.value[assistantMessageId]

    if (!run)
      return

    const next = update(run)

    // 没有变化（如同一段正文里的后续 delta）不写入，不触发轮次重算。
    if (next !== run)
      turnRuns.value = { ...turnRuns.value, [assistantMessageId]: next }
  }

  function stopGeneration() {
    const request = currentRequest.value
    if (!request?.active)
      return

    flushPendingDelta(request)
    request.controller.abort()
    markGenerationAborted(request)
  }

  async function loadConversationList() {
    try {
      loadingConversationList.value = true
      conversationError.value = ''

      const response = await listConversations({
        limit: CONVERSATION_PAGE_SIZE,
      })

      if (isUnmounted)
        return
      conversations.value = sortConversationsByUpdatedAt(mergeConversations(response.items, conversations.value))
      conversationNextCursor = response.nextCursor
      hasMoreConversations.value = Boolean(response.nextCursor)
    }
    catch (error) {
      handleWorkspaceError(error)
    }
    finally {
      loadingConversationList.value = false
    }
  }

  /**
   * 收到 start / done 后只把会话提到侧栏顶部：后端每写一条消息只更新 conversation.updatedAt，
   * 标题不会变，列表按 updatedAt 排序，本地改时间戳即可，不再整页重拉列表。
   */
  function touchConversation(conversationId: string) {
    const conversation = conversations.value.find(item => item.id === conversationId)

    if (!conversation)
      return

    // 本地时钟可能落后服务端：取不早于列表里最新时间戳的值，保证它排到顶部。
    const latestKnown = Math.max(
      Date.now(),
      ...conversations.value.map(item => new Date(item.updatedAt).getTime() + 1),
    )

    upsertConversation({ ...conversation, updatedAt: new Date(latestKnown).toISOString() })
  }

  async function loadMoreConversations() {
    if (!conversationNextCursor || isLoadingMoreConversations.value || isLoadingConversations.value)
      return

    try {
      isLoadingMoreConversations.value = true
      conversationError.value = ''

      const response = await listConversations({
        cursor: conversationNextCursor,
        limit: CONVERSATION_PAGE_SIZE,
      })

      conversations.value = mergeConversations(conversations.value, response.items)
      conversationNextCursor = response.nextCursor
      hasMoreConversations.value = Boolean(response.nextCursor)
    }
    catch (error) {
      handleWorkspaceError(error)
    }
    finally {
      isLoadingMoreConversations.value = false
    }
  }

  async function loadMessagesForConversation(conversationId: string) {
    const runId = ++messageLoadRunId
    const versionBeforeLoad = conversationMessagesVersion.get(conversationId) ?? 0
    if (!conversationMessagesCache.has(conversationId))
      isHistoryReady.value = false

    try {
      isLoadingMessages.value = true
      conversationError.value = ''

      const nextMessages = await listConversationMessages(conversationId)

      if (isUnmounted || runId !== messageLoadRunId || conversationId !== activeConversationId.value)
        return

      // 两种情况都保留本地事实、丢弃服务端快照：该会话仍在流式中，或
      // fetch 期间本地消息已被流事件更新过（典型：切走再切回后 done 先到，
      // 服务端快照是流终态之前的旧数据）。
      const versionChanged
        = (conversationMessagesVersion.get(conversationId) ?? 0) !== versionBeforeLoad

      const request = requests.get(conversationId)
      // 本地停止/网络失败可能还没反映在服务端，切回时保留其正文和终态。
      if (request?.active || request?.status === 'error' || request?.status === 'aborted' || versionChanged) {
        const cachedMessages = conversationMessagesCache.get(conversationId)

        if (cachedMessages) {
          messages.value = [...cachedMessages]
          isHistoryReady.value = true
        }

        return
      }

      setMessagesForConversation(conversationId, nextMessages)
    }
    catch (error) {
      if (isUnmounted || runId !== messageLoadRunId)
        return

      // HTTP 失败不是本地消息消失的事实，不能清空刚到达的流终态或已有历史。
      handleWorkspaceError(error)
    }
    finally {
      if (runId === messageLoadRunId) {
        isLoadingMessages.value = false
      }
    }
  }

  function buildChatRequest(
    conversationId: string,
    messageContent: string,
    attachmentIds: string[],
    model?: string | null,
    reasoningEffort?: ReasoningEffort,
  ): ChatRequest {
    const nextModel = model?.trim()

    return {
      conversationId,
      message: messageContent,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...(nextModel ? { model: nextModel } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
    }
  }

  function handleStreamStartEvent(
    event: Extract<ChatStreamEvent, { type: 'start' }>,
    pendingMessage: ConversationMessage,
  ) {
    const now = createMessageTimestamp()

    replaceMessageInConversation(pendingMessage.conversationId, pendingMessage.id, {
      ...pendingMessage,
      id: event.userMessageId,
      status: 'COMPLETED',
      updatedAt: now,
    })
    clearLocalTurnError(pendingMessage.id)

    upsertMessageInConversation(createStreamingAssistantMessage(
      event.conversationId,
      event.assistantMessageId,
      now,
    ))
  }

  function handleStreamDeltaEvent(request: ChatRequestState, event: Extract<ChatStreamEvent, { type: 'delta' }>) {
    if (request.pendingDelta)
      request.pendingDelta.contentDelta += event.contentDelta
    else
      request.pendingDelta = { ...event }
    // 每条请求独立攒帧；后台标签页不派发 rAF，切回或终态前主动写入。
    request.deltaFrame ??= requestAnimationFrame(() => flushPendingDelta(request))
  }

  function handleStreamReasoningDeltaEvent(request: ChatRequestState, event: Extract<ChatStreamEvent, { type: 'reasoning_delta' }>) {
    if (request.pendingReasoning)
      request.pendingReasoning.delta += event.delta
    else
      request.pendingReasoning = { ...event }
    request.reasoningTimer ??= window.setTimeout(flushPendingReasoning, REASONING_FLUSH_MS, request)
  }

  function flushPendingReasoning(request: ChatRequestState) {
    const reasoning = request.pendingReasoning
    window.clearTimeout(request.reasoningTimer)
    request.reasoningTimer = undefined
    request.pendingReasoning = null
    if (reasoning && ownsActiveRequest(request))
      updateTurnRun(reasoning.assistantMessageId, run => applyRunEvent(run, reasoning, performance.now()))
  }

  function flushPendingDelta(request: ChatRequestState) {
    if (request.deltaFrame !== undefined) {
      cancelAnimationFrame(request.deltaFrame)
      request.deltaFrame = undefined
    }
    flushPendingReasoning(request)
    const delta = request.pendingDelta
    request.pendingDelta = null
    if (!delta || !ownsActiveRequest(request))
      return

    const hasUpdatedMessage = updateMessageById(
      delta.conversationId,
      delta.assistantMessageId,
      currentMessage => ({
        ...currentMessage,
        content: `${currentMessage.content}${delta.contentDelta}`,
        status: 'STREAMING',
        updatedAt: createMessageTimestamp(),
      }),
    )

    if (!hasUpdatedMessage) {
      upsertMessageInConversation({
        ...createStreamingAssistantMessage(delta.conversationId, delta.assistantMessageId),
        content: delta.contentDelta,
      })
    }
  }

  function handleStreamDoneEvent(event: Extract<ChatStreamEvent, { type: 'done' }>) {
    const hasUpdatedMessage = updateMessageById(
      event.conversationId,
      event.assistantMessageId,
      currentMessage => ({
        ...currentMessage,
        content: event.content,
        status: 'COMPLETED',
        updatedAt: event.generatedAt,
      }),
    )

    if (!hasUpdatedMessage) {
      upsertMessageInConversation({
        id: event.assistantMessageId,
        conversationId: event.conversationId,
        role: 'ASSISTANT',
        content: event.content,
        status: 'COMPLETED',
        createdAt: event.generatedAt,
        updatedAt: event.generatedAt,
      })
    }
  }

  function handleStreamErrorEvent(
    event: Extract<ChatStreamEvent, { type: 'error' }>,
    pendingMessage: ConversationMessage | undefined,
  ) {
    if (event.assistantMessageId) {
      setLocalTurnError(event.assistantMessageId, event.message)
      markAssistantMessageFailed(event.conversationId, event.assistantMessageId, event.message)
      return
    }

    if (pendingMessage)
      setLocalTurnError(pendingMessage.id, event.message)
  }

  function handleStreamAbortedEvent(event: Extract<ChatStreamEvent, { type: 'aborted' }>) {
    markAssistantMessageAborted(event.conversationId, event.assistantMessageId, event.content)
  }

  function markGenerationAborted(request: ChatRequestState) {
    if (!ownsActiveRequest(request))
      return

    if (request.assistantMessageId && request.conversationId) {
      endTurnRun(request.assistantMessageId, 'aborted')
      markAssistantMessageAborted(request.conversationId, request.assistantMessageId)
    }
    else if (request.conversationId) {
      // start 前停止只创建一次占位；终态立刻释放该会话，旧回调不再接管。
      upsertMessageInConversation(createAbortedAssistantMessage(request.conversationId, request.requestId))
    }
    finishRequest(request, 'aborted')
  }

  function markAssistantMessageAborted(
    conversationId: string,
    assistantMessageId: string,
    content?: string,
  ) {
    const now = createMessageTimestamp()
    const hasUpdatedMessage = updateMessageById(
      conversationId,
      assistantMessageId,
      currentMessage => ({
        ...currentMessage,
        content: content ?? currentMessage.content,
        status: 'ABORTED',
        updatedAt: now,
      }),
    )

    if (hasUpdatedMessage)
      return

    upsertMessageInConversation({
      id: assistantMessageId,
      conversationId,
      role: 'ASSISTANT',
      content: content ?? '',
      status: 'ABORTED',
      createdAt: now,
      updatedAt: now,
    })
  }

  function markAssistantMessageFailed(
    conversationId: string,
    assistantMessageId: string,
    nextErrorMessage: string,
  ) {
    const hasUpdatedMessage = updateMessageById(
      conversationId,
      assistantMessageId,
      currentMessage => ({
        ...currentMessage,
        content: currentMessage.content || nextErrorMessage,
        status: 'FAILED',
        updatedAt: createMessageTimestamp(),
      }),
    )

    if (!hasUpdatedMessage) {
      const now = createMessageTimestamp()

      upsertMessageInConversation({
        id: assistantMessageId,
        conversationId,
        role: 'ASSISTANT',
        content: nextErrorMessage,
        status: 'FAILED',
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  function upsertMessageInConversation(nextMessage: ConversationMessage) {
    const currentMessages = getMessagesForConversation(nextMessage.conversationId)
    const nextMessages = [
      ...currentMessages.filter(item => item.id !== nextMessage.id),
      nextMessage,
    ]

    setMessagesForConversation(nextMessage.conversationId, nextMessages)
  }

  function replaceMessageInConversation(
    conversationId: string,
    oldMessageId: string,
    nextMessage: ConversationMessage,
  ) {
    const currentMessages = getMessagesForConversation(conversationId)
    const nextMessages = [
      ...currentMessages.filter(item => item.id !== oldMessageId && item.id !== nextMessage.id),
      nextMessage,
    ]

    setMessagesForConversation(conversationId, nextMessages)
  }

  function updateMessageById(
    conversationId: string,
    messageId: string,
    updater: (message: ConversationMessage) => ConversationMessage,
  ): boolean {
    const currentMessages = getMessagesForConversation(conversationId)
    const messageIndex = currentMessages.findIndex(item => item.id === messageId)

    if (messageIndex < 0)
      return false

    const nextMessages = [...currentMessages]

    nextMessages[messageIndex] = updater(currentMessages[messageIndex])
    // 原地更新不改 createdAt，顺序不变，不用重新排序。
    setMessagesForConversation(conversationId, nextMessages, { sort: false })

    return true
  }

  function getMessagesForConversation(conversationId: string): ConversationMessage[] {
    if (conversationId === activeConversationId.value)
      return messages.value

    return conversationMessagesCache.get(conversationId) ?? []
  }

  function setMessagesForConversation(
    conversationId: string,
    nextMessages: ConversationMessage[],
    { sort = true }: { sort?: boolean } = {},
  ) {
    const sortedMessages = sort ? [...nextMessages].sort(compareMessagesByCreatedAt) : nextMessages

    conversationMessagesVersion.set(
      conversationId,
      (conversationMessagesVersion.get(conversationId) ?? 0) + 1,
    )
    cacheMessagesForConversation(conversationId, sortedMessages)

    if (conversationId === activeConversationId.value) {
      messages.value = [...sortedMessages]
      isHistoryReady.value = true
    }
  }

  function upsertConversation(conversation: Conversation) {
    conversations.value = sortConversationsByUpdatedAt([
      conversation,
      ...conversations.value.filter(item => item.id !== conversation.id),
    ])
  }

  function mergeConversations(
    currentConversations: Conversation[],
    nextConversations: Conversation[],
  ): Conversation[] {
    const conversationMap = new Map<string, Conversation>()

    for (const conversation of [...currentConversations, ...nextConversations]) {
      conversationMap.set(conversation.id, conversation)
    }

    return [...conversationMap.values()]
  }

  function createPendingUserMessage(
    conversationId: string,
    content: string,
  ): ConversationMessage {
    const now = createMessageTimestamp()

    return {
      id: createClientMessageId(),
      conversationId,
      role: 'USER',
      content,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    }
  }

  function createStreamingAssistantMessage(
    conversationId: string,
    assistantMessageId: string,
    createdAt = createMessageTimestamp(),
  ): ConversationMessage {
    return {
      id: assistantMessageId,
      conversationId,
      role: 'ASSISTANT',
      content: '',
      status: 'STREAMING',
      createdAt,
      updatedAt: createdAt,
    }
  }

  function createAbortedAssistantMessage(conversationId: string, requestId: string): ConversationMessage {
    const now = createMessageTimestamp()

    return {
      id: `${requestId}-aborted`,
      conversationId,
      role: 'ASSISTANT',
      content: '',
      status: 'ABORTED',
      createdAt: now,
      updatedAt: now,
    }
  }

  function createMessageTimestamp(): string {
    return new Date().toISOString()
  }

  function createClientMessageId(): string {
    // 局域网 HTTP 不提供 randomUUID；getRandomValues 不要求安全上下文。
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return `local-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`
  }

  function createConversationTitle(content: string): string {
    const normalizedContent = content.replace(/\s+/g, ' ').trim()

    if (!normalizedContent)
      return '新的会话'

    return normalizedContent.length > CONVERSATION_TITLE_MAX_LENGTH
      ? `${normalizedContent.slice(0, CONVERSATION_TITLE_MAX_LENGTH)}...`
      : normalizedContent
  }

  function applyCachedMessagesForConversation(conversationId: string) {
    messageLoadRunId += 1

    const cachedMessages = conversationMessagesCache.get(conversationId)

    messages.value = cachedMessages ? [...cachedMessages] : []
    isHistoryReady.value = cachedMessages !== undefined
  }

  function cacheMessagesForConversation(
    conversationId: string,
    nextMessages: ConversationMessage[],
  ) {
    conversationMessagesCache.set(conversationId, [...nextMessages])
  }

  function clearActiveMessages() {
    messageLoadRunId += 1
    messages.value = []
    isLoadingMessages.value = false
    isHistoryReady.value = activeConversationId.value === null
  }

  function resetComposerState() {
    message.value = ''
    attachments.value = []
    hideMessage()
    shouldAnchorLatestTurn.value = false
  }

  function canStartChatRequest(): boolean {
    const request = currentRequest.value
    return !isUnmounted && isHistoryReady.value && !request?.active
      && (Boolean(message.value.trim()) || attachments.value.length > 0)
      && attachments.value.every(item => item.status === 'ready' && item.remoteId)
      && (!request || Date.now() - request.requestedAt >= CHAT_REQUEST_INTERVAL_MS)
  }

  function getSettledWorkspaceStatus(): GenerationStatus {
    return messages.value.length > 0 ? 'idle' : 'empty'
  }

  function setLocalTurnError(messageId: string, nextErrorMessage: string) {
    localTurnErrors.value = {
      ...localTurnErrors.value,
      [messageId]: nextErrorMessage,
    }
  }

  function clearLocalTurnError(messageId: string) {
    if (!(messageId in localTurnErrors.value))
      return

    const nextLocalTurnErrors = { ...localTurnErrors.value }

    delete nextLocalTurnErrors[messageId]

    localTurnErrors.value = nextLocalTurnErrors
  }

  function handleWorkspaceError(error: unknown) {
    const nextErrorMessage = getRequestErrorMessage(error)

    conversationError.value = nextErrorMessage
    showMessage(nextErrorMessage, 'error')
  }

  function getRequestErrorMessage(error: unknown): string {
    if (isAxiosError<ApiErrorResponse>(error)) {
      const responseData = error.response?.data
      const details = responseData?.error?.details

      if (Array.isArray(details) && details.length > 0) {
        return String(details[0])
      }

      return responseData?.message ?? t('conversation.fallbackError')
    }

    if (error instanceof Error) {
      return error.message
    }

    return t('conversation.fallbackError')
  }

  function isAbortError(error: unknown): boolean {
    return (
      (isAxiosError(error) && error.code === 'ERR_CANCELED')
      || (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError')
    )
  }

  function showMessage(text: string, type: AppMessageType = 'info') {
    // 卸载后不再重建定时器：清理钩子已经跑过，新建的 timer 无人回收。
    if (isUnmounted)
      return

    if (messageTimer !== undefined) {
      window.clearTimeout(messageTimer)
    }

    appMessage.value = {
      visible: true,
      type,
      text,
    }

    const timeout = type === 'error' ? ERROR_MESSAGE_TIMEOUT_MS : DEFAULT_MESSAGE_TIMEOUT_MS

    messageTimer = window.setTimeout(() => {
      hideMessage()
    }, timeout)
  }

  function hideMessage() {
    if (messageTimer !== undefined) {
      window.clearTimeout(messageTimer)
      messageTimer = undefined
    }

    appMessage.value = {
      ...appMessage.value,
      visible: false,
    }
  }

  return {
    message,
    attachments,
    status,
    errorMessage,
    conversations,
    activeConversationId,
    messages,
    isLoadingConversations,
    isLoadingMoreConversations,
    isLoadingMessages,
    isHistoryReady,
    reloadMessages: () => activeConversationId.value ? loadMessagesForConversation(activeConversationId.value) : Promise.resolve(),
    shouldAnchorLatestTurn,
    hasMoreConversations,
    conversationError,
    recentChats,
    appMessage,
    conversationTurns,
    messageCharacterCount,
    resetWorkspace,
    selectConversation,
    deleteConversationById,
    renameConversationById,
    loadMoreConversations,
    sendMessage,
    stopGeneration,
    showMessage,
    hideMessage,
  }
}
