import type { ApiErrorResponse } from '../api/http'
import type { AgentRecentChat } from '../types/agent-platform'
import type { Conversation, ConversationMessage } from '../types/conversation'
import type {
  AppMessageState,
  AppMessageType,
  GenerationStatus,
  SeoChatRequest,
} from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  createConversation,
  deleteConversation,
  listConversationMessages,
  listConversations,
} from '../api/conversations'
import { chatWithSeoAgent } from '../api/seo'
import {
  compareMessagesByCreatedAt,
  mapMessagesToConversationTurns,
  sortConversationsByUpdatedAt,
} from '../utils/conversation-turns'
import { formatGeneratedTime } from '../utils/seo-format'

const CHAT_REQUEST_INTERVAL_MS = 800
const DEFAULT_MESSAGE_TIMEOUT_MS = 3600
const ERROR_MESSAGE_TIMEOUT_MS = 6400

export function useSeoWorkspace() {
  const { t } = useI18n()
  const message = ref('')
  const status = ref<GenerationStatus>('empty')
  const errorMessage = ref('')
  const conversations = ref<Conversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const messages = ref<ConversationMessage[]>([])
  const isLoadingConversations = ref(false)
  const isLoadingMessages = ref(false)
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
      updatedAt: formatGeneratedTime(new Date(conversation.updatedAt)),
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

  async function resetWorkspace() {
    if (status.value === 'loading')
      return

    try {
      isLoadingConversations.value = true
      conversationError.value = ''

      const conversation = await createConversation()

      conversations.value = sortConversationsByUpdatedAt([
        conversation,
        ...conversations.value.filter(item => item.id !== conversation.id),
      ])
      activeConversationId.value = conversation.id
      clearActiveMessages()
      resetComposerState()
    }
    catch (error) {
      handleWorkspaceError(error)
    }
    finally {
      isLoadingConversations.value = false
    }
  }

  async function selectConversation(conversationId: string) {
    if (conversationId === activeConversationId.value)
      return

    activeConversationId.value = conversationId
    clearActiveMessages()
    resetComposerState()
    await loadMessagesForConversation(conversationId)
  }

  async function deleteConversationById(conversationId: string) {
    if (status.value === 'loading')
      return

    try {
      isLoadingConversations.value = true
      conversationError.value = ''

      await deleteConversation(conversationId)

      const nextConversations = conversations.value.filter(item => item.id !== conversationId)

      conversations.value = nextConversations

      if (activeConversationId.value !== conversationId)
        return

      const nextActiveConversationId = nextConversations[0]?.id ?? null

      activeConversationId.value = nextActiveConversationId
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

  async function sendMessage(model?: string) {
    if (!canStartChatRequest())
      return

    const messageContent = message.value.trim()
    let targetConversationId = activeConversationId.value
    let pendingMessage: ConversationMessage | undefined

    status.value = 'loading'
    errorMessage.value = ''

    try {
      if (!targetConversationId) {
        const conversation = await createConversation()

        conversations.value = sortConversationsByUpdatedAt([
          conversation,
          ...conversations.value.filter(item => item.id !== conversation.id),
        ])
        activeConversationId.value = conversation.id
        targetConversationId = conversation.id
      }

      const request = buildChatRequest(targetConversationId, messageContent, model)
      pendingMessage = createPendingUserMessage(targetConversationId, request.message)
      activeTurnId = pendingMessage.id

      if (targetConversationId === activeConversationId.value) {
        appendMessage(pendingMessage)
      }

      await chatWithSeoAgent(request)
      message.value = ''
      activeTurnId = null

      if (targetConversationId === activeConversationId.value) {
        await loadMessagesForConversation(targetConversationId)
      }
      else {
        status.value = messages.value.length > 0 ? 'success' : 'empty'
      }

      await refreshConversationList()
    }
    catch (error) {
      const nextErrorMessage = getRequestErrorMessage(error)

      status.value = 'error'
      errorMessage.value = nextErrorMessage

      if (pendingMessage) {
        localTurnErrors.value = {
          ...localTurnErrors.value,
          [pendingMessage.id]: nextErrorMessage,
        }
      }

      showMessage(nextErrorMessage, 'error')
      activeTurnId = null
    }
  }

  async function loadConversationList() {
    try {
      isLoadingConversations.value = true
      conversationError.value = ''
      conversations.value = sortConversationsByUpdatedAt(await listConversations())
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
      conversations.value = sortConversationsByUpdatedAt(await listConversations())

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

  async function loadMessagesForConversation(conversationId: string) {
    const runId = ++messageLoadRunId

    try {
      isLoadingMessages.value = true
      conversationError.value = ''
      localTurnErrors.value = {}

      const nextMessages = await listConversationMessages(conversationId)

      if (runId !== messageLoadRunId || conversationId !== activeConversationId.value)
        return

      messages.value = nextMessages
      status.value = nextMessages.length > 0 ? 'success' : 'empty'
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

  function appendMessage(nextMessage: ConversationMessage) {
    messages.value = [
      ...messages.value.filter(item => item.id !== nextMessage.id),
      nextMessage,
    ].sort(compareMessagesByCreatedAt)
  }

  function createPendingUserMessage(
    conversationId: string,
    content: string,
  ): ConversationMessage {
    const now = new Date().toISOString()

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

  function createClientMessageId(): string {
    return `local-${crypto.randomUUID()}`
  }

  function clearActiveMessages() {
    messageLoadRunId += 1
    messages.value = []
    localTurnErrors.value = {}
    activeTurnId = null
  }

  function resetComposerState() {
    message.value = ''
    status.value = messages.value.length > 0 ? 'success' : 'empty'
    errorMessage.value = ''
    hideMessage()
    activeTurnId = null
  }

  function canStartChatRequest(): boolean {
    if (status.value === 'loading')
      return false

    if (!message.value.trim())
      return false

    const now = Date.now()

    if (now - lastChatRequestedAt < CHAT_REQUEST_INTERVAL_MS)
      return false

    lastChatRequestedAt = now

    return true
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
    isLoadingMessages,
    conversationError,
    recentChats,
    appMessage,
    conversationTurns,
    messageCharacterCount,
    resetWorkspace,
    selectConversation,
    deleteConversationById,
    sendMessage,
    hideMessage,
  }
}
