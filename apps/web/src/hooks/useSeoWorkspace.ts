import type { ApiErrorResponse } from '../api/http'
import type { AppMessageState, AppMessageType, GenerationStatus, SeoChatRequest, SeoChatResponse, SeoConversationTurn } from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { chatWithSeoAgent } from '../api/seo'
import { formatGeneratedTime } from '../utils/seo-format'

const CHAT_REQUEST_INTERVAL_MS = 800
const DEFAULT_MESSAGE_TIMEOUT_MS = 3600
const ERROR_MESSAGE_TIMEOUT_MS = 6400
const MAX_CONVERSATION_TURNS = 12

export function useSeoWorkspace() {
  const { t } = useI18n()
  const message = ref('')
  const status = ref<GenerationStatus>('empty')
  const lastGeneratedAt = ref('--:--')
  const errorMessage = ref('')
  const conversationTurns = ref<SeoConversationTurn[]>([])
  const appMessage = ref<AppMessageState>({
    visible: false,
    type: 'info',
    text: '',
  })
  let messageTimer: number | undefined
  let lastChatRequestedAt = 0
  let activeTurnId: string | null = null

  const messageCharacterCount = computed(() => message.value.length)

  function resetWorkspace() {
    message.value = ''
    conversationTurns.value = []
    status.value = 'empty'
    errorMessage.value = ''
    hideMessage()
    lastGeneratedAt.value = '--:--'
    activeTurnId = null
  }

  async function sendMessage(model?: string) {
    if (!canStartChatRequest())
      return

    const request = buildChatRequest(model)
    const turnId = appendConversationTurn(request.message)

    activeTurnId = turnId
    status.value = 'loading'
    errorMessage.value = ''

    try {
      const response = await chatWithSeoAgent(request)

      if (!isActiveTurn(turnId))
        return

      applyChatResponse(turnId, response)
      message.value = ''
      status.value = 'success'
      activeTurnId = null
    }
    catch (error) {
      if (!isActiveTurn(turnId))
        return

      const nextErrorMessage = getChatErrorMessage(error)

      status.value = 'error'
      errorMessage.value = nextErrorMessage
      updateConversationTurn(turnId, {
        status: 'error',
        errorMessage: nextErrorMessage,
      })
      showMessage(errorMessage.value, 'error')
      activeTurnId = null
    }
  }

  function buildChatRequest(model?: string): SeoChatRequest {
    const nextModel = model?.trim()

    return {
      message: message.value.trim(),
      ...(nextModel ? { model: nextModel } : {}),
    }
  }

  function appendConversationTurn(userMessage: string): string {
    const turnId = createConversationTurnId()

    conversationTurns.value = [
      ...conversationTurns.value.slice(-(MAX_CONVERSATION_TURNS - 1)),
      {
        id: turnId,
        userMessage,
        status: 'loading',
        createdAt: new Date().toISOString(),
      },
    ]

    return turnId
  }

  function updateConversationTurn(
    turnId: string,
    patch: Partial<Omit<SeoConversationTurn, 'id' | 'userMessage' | 'createdAt'>>,
  ) {
    conversationTurns.value = conversationTurns.value.map((turn) => {
      if (turn.id !== turnId)
        return turn

      return {
        ...turn,
        ...patch,
      }
    })
  }

  function canStartChatRequest(): boolean {
    if (status.value === 'loading')
      return false

    const now = Date.now()

    if (now - lastChatRequestedAt < CHAT_REQUEST_INTERVAL_MS)
      return false

    lastChatRequestedAt = now

    return true
  }

  function applyChatResponse(turnId: string, response: SeoChatResponse) {
    updateConversationTurn(turnId, {
      status: 'success',
      reply: response.reply,
      generatedAt: response.generatedAt,
      errorMessage: undefined,
    })
    lastGeneratedAt.value = formatGeneratedTime(new Date(response.generatedAt))
  }

  function isActiveTurn(turnId: string): boolean {
    return activeTurnId === turnId
  }

  function getChatErrorMessage(error: unknown): string {
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

  function createConversationTurnId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  return {
    message,
    status,
    lastGeneratedAt,
    errorMessage,
    appMessage,
    conversationTurns,
    messageCharacterCount,
    resetWorkspace,
    sendMessage,
    hideMessage,
  }
}
