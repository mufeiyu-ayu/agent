import type { ApiErrorResponse } from '../api/http'
import type { AppMessageState, AppMessageType, GenerationStatus, SeoChatRequest, SeoChatResponse, SeoConversationTurn, SeoInputValidationErrors } from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, ref, watch } from 'vue'

import { chatWithSeoAgent } from '../api/seo'
import { formatGeneratedTime } from '../utils/seo-format'

const CHAT_REQUEST_INTERVAL_MS = 800
const MAX_CONVERSATION_TURNS = 12

export function useSeoWorkspace() {
  const message = ref('帮我看看一个游戏充值网站的 SEO 应该先从哪里优化？')
  const status = ref<GenerationStatus>('empty')
  const lastGeneratedAt = ref('--:--')
  const errorMessage = ref('')
  const validationErrors = ref<SeoInputValidationErrors>({})
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
    validationErrors.value = {}
    hideMessage()
    lastGeneratedAt.value = '--:--'
    activeTurnId = null
  }

  async function sendMessage(model?: string) {
    if (!validateBeforeSend()) {
      status.value = 'empty'
      errorMessage.value = ''
      return
    }

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

  function validateBeforeSend(): boolean {
    const nextErrors: SeoInputValidationErrors = {}

    if (!message.value.trim()) {
      nextErrors.message = '请输入你想和 SEO Agent 讨论的问题。'
    }

    validationErrors.value = nextErrors

    return Object.keys(nextErrors).length === 0
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

  function clearValidationError(field: keyof SeoInputValidationErrors) {
    if (!validationErrors.value[field])
      return

    const nextErrors = { ...validationErrors.value }

    delete nextErrors[field]
    validationErrors.value = nextErrors
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

      return responseData?.message ?? 'SEO Agent 暂时无法回复，请稍后重试。'
    }

    if (error instanceof Error) {
      return error.message
    }

    return 'SEO Agent 暂时无法回复，请稍后重试。'
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

    messageTimer = window.setTimeout(() => {
      hideMessage()
    }, 3600)
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

  watch(message, (value) => {
    if (value.trim())
      clearValidationError('message')
  })

  return {
    message,
    status,
    lastGeneratedAt,
    errorMessage,
    validationErrors,
    appMessage,
    conversationTurns,
    messageCharacterCount,
    resetWorkspace,
    sendMessage,
    hideMessage,
  }
}
