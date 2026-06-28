import type {
  ApiErrorResponse,
  ChatStreamEvent,
  Conversation,
  ConversationMessage,
  SeoChatRequest,
} from '@agent/contracts'
import type { AgentRecentChat } from '../types/agent-platform'
import type {
  AppMessageState,
  AppMessageType,
  GenerationStatus,
} from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  createConversation,
  deleteConversation,
  listConversationMessages,
  listConversations,
  updateConversation,
} from '../api/conversations'
import { streamChatWithSeoAgent } from '../api/seo'
import {
  compareMessagesByCreatedAt,
  mapMessagesToConversationTurns,
  sortConversationsByUpdatedAt,
} from '../utils/conversation-turns'
import { formatGeneratedTime } from '../utils/seo-format'

const CHAT_REQUEST_INTERVAL_MS = 800
const DEFAULT_MESSAGE_TIMEOUT_MS = 3600
const ERROR_MESSAGE_TIMEOUT_MS = 6400
const CONVERSATION_PAGE_SIZE = 20
const CONVERSATION_TITLE_MAX_LENGTH = 28

export function useSeoWorkspace() {
  const { t } = useI18n()
  const message = ref('')
  const status = ref<GenerationStatus>('empty')
  const errorMessage = ref('')
  const conversations = ref<Conversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const messages = ref<ConversationMessage[]>([])
  const isLoadingConversations = ref(false)
  const isLoadingMoreConversations = ref(false)
  const isLoadingMessages = ref(false)
  const shouldAnchorLatestTurn = ref(false)
  const hasMoreConversations = ref(false)
  const conversationError = ref('')
  const localTurnErrors = ref<Record<string, string>>({})
  const appMessage = ref<AppMessageState>({
    visible: false,
    type: 'info',
    text: '',
  })

  let messageTimer: number | undefined
  let lastChatRequestedAt = 0
  let activeTurnId: string | null = null
  let messageLoadRunId = 0
  let conversationNextCursor: string | null = null
  let activeAbortController: AbortController | null = null
  let activeStreamRequestId: string | null = null
  let activeStreamConversationId: string | null = null
  let activeStreamAssistantMessageId: string | null = null
  const conversationMessagesCache = new Map<string, ConversationMessage[]>()

  const messageCharacterCount = computed(() => message.value.length)

  const conversationTurns = computed(() => {
    return mapMessagesToConversationTurns(messages.value, {
      activeTurnId,
      turnErrors: localTurnErrors.value,
    })
  })

  const lastGeneratedAt = computed(() => {
    const lastAssistantMessage = [...messages.value]
      .reverse()
      .find(item => item.role === 'ASSISTANT')

    if (!lastAssistantMessage)
      return '--:--'

    return formatGeneratedTime(new Date(lastAssistantMessage.createdAt))
  })

  const recentChats = computed<AgentRecentChat[]>(() => {
    return conversations.value.map(conversation => ({
      id: conversation.id,
      title: conversation.title,
      active: conversation.id === activeConversationId.value,
    }))
  })

  onMounted(() => {
    void initializeWorkspace()
  })

  async function initializeWorkspace() {
    await loadConversationList()

    const initialConversationId = conversations.value[0]?.id ?? null
    activeConversationId.value = initialConversationId

    if (initialConversationId) {
      await loadMessagesForConversation(initialConversationId)
      return
    }

    clearActiveMessages()
  }

  function resetWorkspace() {
    if (isGenerationInProgress())
      return

    activeConversationId.value = null
    clearActiveMessages()
    resetComposerState()
  }

  async function selectConversation(conversationId: string) {
    if (conversationId === activeConversationId.value)
      return

    shouldAnchorLatestTurn.value = false
    activeConversationId.value = conversationId
    applyCachedMessagesForConversation(conversationId)
    resetComposerState()
    await loadMessagesForConversation(conversationId)
  }

  async function deleteConversationById(conversationId: string) {
    if (isGenerationInProgress())
      return

    try {
      isLoadingConversations.value = true
      conversationError.value = ''

      await deleteConversation(conversationId)
      conversationMessagesCache.delete(conversationId)

      const nextConversations = conversations.value.filter(item => item.id !== conversationId)

      conversations.value = nextConversations

      if (activeConversationId.value !== conversationId)
        return

      const nextActiveConversationId = nextConversations[0]?.id ?? null

      activeConversationId.value = nextActiveConversationId
      shouldAnchorLatestTurn.value = false
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
      isLoadingConversations.value = false
    }
  }

  async function renameConversationById(conversationId: string, title: string) {
    const nextTitle = title.trim()

    if (!nextTitle)
      return

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
  }

  async function sendMessage(model?: string) {
    if (!canStartChatRequest())
      return

    const messageContent = message.value.trim()
    let targetConversationId = activeConversationId.value
    let pendingMessage: ConversationMessage | undefined
    let assistantMessageId: string | undefined
    let hasFinalStreamEvent = false
    const streamRequestId = createClientMessageId()
    const abortController = new AbortController()

    status.value = 'thinking'
    errorMessage.value = ''
    shouldAnchorLatestTurn.value = true
    activeAbortController = abortController
    activeStreamRequestId = streamRequestId
    activeStreamConversationId = targetConversationId
    activeStreamAssistantMessageId = null

    try {
      if (!targetConversationId) {
        const conversation = await createConversation({
          title: createConversationTitle(messageContent),
        }, {
          signal: abortController.signal,
        })

        upsertConversation(conversation)
        activeConversationId.value = conversation.id
        targetConversationId = conversation.id
        activeStreamConversationId = conversation.id
      }

      const request = buildChatRequest(targetConversationId, messageContent, model)
      pendingMessage = createPendingUserMessage(targetConversationId, request.message)
      activeTurnId = pendingMessage.id

      upsertMessageInConversation(pendingMessage)

      for await (const event of streamChatWithSeoAgent(request, {
        signal: abortController.signal,
      })) {
        if (event.conversationId !== targetConversationId)
          continue

        if (event.type === 'start') {
          assistantMessageId = event.assistantMessageId
          activeStreamAssistantMessageId = event.assistantMessageId
          handleStreamStartEvent(event, pendingMessage)
          message.value = ''
          status.value = 'generating'
          continue
        }

        if (event.type === 'delta') {
          handleStreamDeltaEvent(event)
          status.value = 'generating'
          continue
        }

        if (event.type === 'done') {
          hasFinalStreamEvent = true
          handleStreamDoneEvent(event)
          activeTurnId = null
          clearActiveStreamState(streamRequestId)
          setStatusAfterStreamCompletion(event.conversationId, 'done')
          await refreshConversationList()
          continue
        }

        if (event.type === 'error') {
          hasFinalStreamEvent = true
          errorMessage.value = event.message
          handleStreamErrorEvent(event, pendingMessage)
          activeTurnId = null
          clearActiveStreamState(streamRequestId)
          setStatusAfterStreamError(event.conversationId)
          showMessage(event.message, 'error')
          await refreshConversationList()
          continue
        }

        hasFinalStreamEvent = true
        handleStreamAbortedEvent(event)
        activeTurnId = null
        clearActiveStreamState(streamRequestId)
        setStatusAfterStreamCompletion(event.conversationId, 'aborted')
        await refreshConversationList()
      }

      if (!hasFinalStreamEvent) {
        throw new Error('流式响应提前结束，请稍后重试')
      }
    }
    catch (error) {
      if (isAbortError(error)) {
        markGenerationAborted(targetConversationId, assistantMessageId, streamRequestId)
        await refreshConversationList()
        return
      }

      const nextErrorMessage = getRequestErrorMessage(error)

      errorMessage.value = nextErrorMessage

      if (assistantMessageId && targetConversationId) {
        setLocalTurnError(assistantMessageId, nextErrorMessage)
        markAssistantMessageFailed(targetConversationId, assistantMessageId, nextErrorMessage)
      }
      else if (pendingMessage) {
        setLocalTurnError(pendingMessage.id, nextErrorMessage)
      }

      showMessage(nextErrorMessage, 'error')
      activeTurnId = null
      clearActiveStreamState(streamRequestId)

      const failedConversationId = targetConversationId

      if (failedConversationId) {
        setStatusAfterStreamError(failedConversationId)
        await refreshConversationList()
        return
      }

      status.value = 'error'
    }
  }

  function stopGeneration() {
    if (!isGenerationInProgress())
      return

    const streamRequestId = activeStreamRequestId
    const conversationId = activeStreamConversationId
    const assistantMessageId = activeStreamAssistantMessageId

    activeAbortController?.abort()
    markGenerationAborted(conversationId, assistantMessageId, streamRequestId)
  }

  async function loadConversationList() {
    try {
      isLoadingConversations.value = true
      conversationError.value = ''

      const response = await listConversations({
        limit: CONVERSATION_PAGE_SIZE,
      })

      conversations.value = response.items
      conversationNextCursor = response.nextCursor
      hasMoreConversations.value = Boolean(response.nextCursor)
    }
    catch (error) {
      handleWorkspaceError(error)
    }
    finally {
      isLoadingConversations.value = false
    }
  }

  async function refreshConversationList() {
    try {
      const response = await listConversations({
        limit: Math.max(conversations.value.length, CONVERSATION_PAGE_SIZE),
      })

      conversations.value = response.items
      conversationNextCursor = response.nextCursor
      hasMoreConversations.value = Boolean(response.nextCursor)

      if (
        activeConversationId.value
        && !conversations.value.some(conversation => conversation.id === activeConversationId.value)
      ) {
        activeConversationId.value = conversations.value[0]?.id ?? null
      }
    }
    catch (error) {
      handleWorkspaceError(error)
    }
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

    try {
      isLoadingMessages.value = true
      conversationError.value = ''

      const nextMessages = await listConversationMessages(conversationId)

      if (runId !== messageLoadRunId || conversationId !== activeConversationId.value)
        return

      if (activeStreamConversationId === conversationId) {
        const cachedMessages = conversationMessagesCache.get(conversationId)

        if (cachedMessages)
          messages.value = [...cachedMessages]

        return
      }

      setMessagesForConversation(conversationId, nextMessages)

      if (!isGenerationInProgress())
        status.value = getSettledWorkspaceStatus()
    }
    catch (error) {
      if (runId !== messageLoadRunId)
        return

      clearActiveMessages()
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
    model?: string,
  ): SeoChatRequest {
    const nextModel = model?.trim()

    return {
      conversationId,
      message: messageContent,
      ...(nextModel ? { model: nextModel } : {}),
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
    activeTurnId = event.userMessageId

    upsertMessageInConversation(createStreamingAssistantMessage(
      event.conversationId,
      event.assistantMessageId,
      now,
    ))
  }

  function handleStreamDeltaEvent(event: Extract<ChatStreamEvent, { type: 'delta' }>) {
    const hasUpdatedMessage = updateMessageById(
      event.conversationId,
      event.assistantMessageId,
      currentMessage => ({
        ...currentMessage,
        content: `${currentMessage.content}${event.contentDelta}`,
        status: 'STREAMING',
        updatedAt: createMessageTimestamp(),
      }),
    )

    if (!hasUpdatedMessage) {
      upsertMessageInConversation({
        ...createStreamingAssistantMessage(event.conversationId, event.assistantMessageId),
        content: event.contentDelta,
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

  function markGenerationAborted(
    conversationId: string | null,
    assistantMessageId: string | null | undefined,
    streamRequestId: string | null,
  ) {
    const shouldUpdateWorkspaceStatus = shouldUpdateActiveStreamState(streamRequestId)

    if (!conversationId) {
      if (shouldUpdateWorkspaceStatus) {
        status.value = 'aborted'
        activeTurnId = null
        clearActiveStreamState(streamRequestId)
      }

      return
    }

    if (assistantMessageId) {
      markAssistantMessageAborted(conversationId, assistantMessageId)
    }
    else {
      upsertMessageInConversation(createAbortedAssistantMessage(conversationId))
    }

    if (shouldUpdateWorkspaceStatus) {
      activeTurnId = null
      setStatusAfterStreamCompletion(conversationId, 'aborted')
      clearActiveStreamState(streamRequestId)
    }
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
    setMessagesForConversation(conversationId, nextMessages)

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
  ) {
    const sortedMessages = [...nextMessages].sort(compareMessagesByCreatedAt)

    cacheMessagesForConversation(conversationId, sortedMessages)

    if (conversationId === activeConversationId.value)
      messages.value = [...sortedMessages]
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

  function createAbortedAssistantMessage(conversationId: string): ConversationMessage {
    const now = createMessageTimestamp()

    return {
      id: createClientMessageId(),
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
    return `local-${crypto.randomUUID()}`
  }

  function createConversationTitle(content: string): string {
    const normalizedContent = content.replace(/\s+/g, ' ').trim()

    if (!normalizedContent)
      return '新的 SEO 会话'

    return normalizedContent.length > CONVERSATION_TITLE_MAX_LENGTH
      ? `${normalizedContent.slice(0, CONVERSATION_TITLE_MAX_LENGTH)}...`
      : normalizedContent
  }

  function applyCachedMessagesForConversation(conversationId: string) {
    messageLoadRunId += 1

    if (!isGenerationInProgress())
      activeTurnId = null

    const cachedMessages = conversationMessagesCache.get(conversationId)

    messages.value = cachedMessages ? [...cachedMessages] : []
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
    localTurnErrors.value = {}
    activeTurnId = null
  }

  function resetComposerState() {
    const shouldKeepGenerationStatus = isGenerationInProgress()

    message.value = ''
    if (!shouldKeepGenerationStatus)
      status.value = getSettledWorkspaceStatus()

    errorMessage.value = ''
    hideMessage()
    if (!shouldKeepGenerationStatus)
      activeTurnId = null

    shouldAnchorLatestTurn.value = false
  }

  function canStartChatRequest(): boolean {
    if (isGenerationInProgress())
      return false

    if (!message.value.trim())
      return false

    const now = Date.now()

    if (now - lastChatRequestedAt < CHAT_REQUEST_INTERVAL_MS)
      return false

    lastChatRequestedAt = now

    return true
  }

  function isGenerationInProgress(): boolean {
    return activeStreamConversationId !== null
      || status.value === 'thinking'
      || status.value === 'generating'
  }

  function clearActiveStreamState(streamRequestId: string | null) {
    if (streamRequestId && activeStreamRequestId !== streamRequestId)
      return

    activeAbortController = null
    activeStreamRequestId = null
    activeStreamConversationId = null
    activeStreamAssistantMessageId = null
  }

  function shouldUpdateActiveStreamState(streamRequestId: string | null): boolean {
    return !streamRequestId
      || activeStreamRequestId === streamRequestId
      || activeStreamRequestId === null
  }

  function getSettledWorkspaceStatus(): GenerationStatus {
    return messages.value.length > 0 ? 'idle' : 'empty'
  }

  function setStatusAfterStreamCompletion(
    conversationId: string,
    nextStatus: Extract<GenerationStatus, 'done' | 'aborted'>,
  ) {
    status.value = conversationId === activeConversationId.value
      ? nextStatus
      : getSettledWorkspaceStatus()
  }

  function setStatusAfterStreamError(conversationId: string) {
    status.value = conversationId === activeConversationId.value
      ? 'error'
      : getSettledWorkspaceStatus()
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
    status,
    lastGeneratedAt,
    errorMessage,
    conversations,
    activeConversationId,
    messages,
    isLoadingConversations,
    isLoadingMoreConversations,
    isLoadingMessages,
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
    hideMessage,
  }
}
