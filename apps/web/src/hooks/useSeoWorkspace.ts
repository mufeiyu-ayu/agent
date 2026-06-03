import type { ApiErrorResponse } from '../api/http'
import type { AppMessageState, AppMessageType, CopyableSeoField, GenerateSeoRequest, GenerateSeoResponse, GenerationStatus, SeoConversationTurn, SeoInputValidationErrors } from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, ref, watch } from 'vue'

import { generateSeoContent as requestSeoContent } from '../api/seo'
import { formatGeneratedTime } from '../utils/seo-format'

const GENERATE_REQUEST_INTERVAL_MS = 800
const MAX_CONVERSATION_TURNS = 8

export function useSeoWorkspace() {
  const pageTopic = ref('PUBG UC 充值页面')
  const language = ref('English')
  const keywordInput = ref('')
  const keywords = ref(['PUBG UC', 'Top up', 'cheap UC', 'instant delivery'])
  const status = ref<GenerationStatus>('empty')
  const lastGeneratedAt = ref('--:--')
  const copiedItemKey = ref<string | null>(null)
  const errorMessage = ref('')
  const validationErrors = ref<SeoInputValidationErrors>({})
  const conversationTurns = ref<SeoConversationTurn[]>([])
  const appMessage = ref<AppMessageState>({
    visible: false,
    type: 'info',
    text: '',
  })
  let messageTimer: number | undefined
  let lastGenerateRequestedAt = 0

  const pageTopicCharacterCount = computed(() => pageTopic.value.length)
  const completionPercent = computed(() => {
    if (status.value === 'success')
      return 100

    if (status.value === 'loading')
      return 64

    return 0
  })

  const statusCardTitle = computed(() => {
    if (status.value === 'loading')
      return 'Analysis running'

    if (status.value === 'error')
      return 'Analysis failed'

    if (status.value === 'empty')
      return 'Ready to analyze'

    return 'Analysis complete'
  })

  const statusCardDescription = computed(() => {
    if (status.value === 'loading')
      return 'AI is analyzing page topic and keywords'

    if (status.value === 'error')
      return errorMessage.value || 'Please adjust the input and retry'

    if (status.value === 'empty')
      return 'Fill in page details to generate SEO content'

    return 'SEO content generated successfully'
  })

  function addKeyword() {
    const nextKeyword = keywordInput.value.trim()

    if (!nextKeyword)
      return

    const exists = keywords.value.some((keyword) => {
      return keyword.toLowerCase() === nextKeyword.toLowerCase()
    })

    if (!exists)
      keywords.value.push(nextKeyword)

    keywordInput.value = ''
    clearValidationError('keywords')
  }

  function removeKeyword(keyword: string) {
    keywords.value = keywords.value.filter(item => item !== keyword)
  }

  function resetWorkspace() {
    pageTopic.value = ''
    keywordInput.value = ''
    keywords.value = []
    conversationTurns.value = []
    status.value = 'empty'
    errorMessage.value = ''
    validationErrors.value = {}
    hideMessage()
    copiedItemKey.value = null
    lastGeneratedAt.value = '--:--'
  }

  async function generateSeoContent() {
    addKeyword()

    if (!validateBeforeGenerate()) {
      status.value = 'empty'
      errorMessage.value = ''
      return
    }

    if (!canStartGenerateRequest())
      return

    const request = buildGenerateRequest()
    const turnId = appendConversationTurn(request)

    status.value = 'loading'
    errorMessage.value = ''

    try {
      const result = await requestSeoContent(request)

      applySeoResult(turnId, result)
      status.value = 'success'
    }
    catch (error) {
      const nextErrorMessage = getGenerateErrorMessage(error)

      status.value = 'error'
      errorMessage.value = nextErrorMessage
      updateConversationTurn(turnId, {
        status: 'error',
        errorMessage: nextErrorMessage,
      })
      showMessage(errorMessage.value, 'error')
    }
  }

  function buildGenerateRequest(): GenerateSeoRequest {
    return {
      pageTopic: pageTopic.value.trim(),
      language: language.value.trim(),
      keywords: [...keywords.value],
    }
  }

  function appendConversationTurn(request: GenerateSeoRequest): string {
    const turnId = createConversationTurnId()

    conversationTurns.value = [
      ...conversationTurns.value.slice(-(MAX_CONVERSATION_TURNS - 1)),
      {
        id: turnId,
        request,
        status: 'loading',
        createdAt: new Date().toISOString(),
      },
    ]

    return turnId
  }

  function updateConversationTurn(
    turnId: string,
    patch: Partial<Omit<SeoConversationTurn, 'id' | 'request' | 'createdAt'>>,
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

  function validateBeforeGenerate(): boolean {
    const nextErrors: SeoInputValidationErrors = {}

    if (!pageTopic.value.trim()) {
      nextErrors.pageTopic = '请输入页面主题。'
    }

    if (keywords.value.length === 0) {
      nextErrors.keywords = '请至少添加一个目标关键词。'
    }

    validationErrors.value = nextErrors

    return Object.keys(nextErrors).length === 0
  }

  function canStartGenerateRequest(): boolean {
    if (status.value === 'loading')
      return false

    const now = Date.now()

    if (now - lastGenerateRequestedAt < GENERATE_REQUEST_INTERVAL_MS)
      return false

    lastGenerateRequestedAt = now

    return true
  }

  function clearValidationError(field: keyof SeoInputValidationErrors) {
    if (!validationErrors.value[field])
      return

    const nextErrors = { ...validationErrors.value }

    delete nextErrors[field]
    validationErrors.value = nextErrors
  }

  function applySeoResult(turnId: string, result: GenerateSeoResponse) {
    updateConversationTurn(turnId, {
      status: 'success',
      result,
      errorMessage: undefined,
    })
    lastGeneratedAt.value = formatGeneratedTime(new Date(result.generatedAt))
  }

  function getGenerateErrorMessage(error: unknown): string {
    if (!isAxiosError<ApiErrorResponse>(error)) {
      return 'Failed to generate SEO content. Please try again.'
    }

    const responseData = error.response?.data
    const details = responseData?.error?.details

    if (Array.isArray(details) && details.length > 0) {
      return String(details[0])
    }

    return responseData?.message ?? 'Failed to generate SEO content. Please try again.'
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

  async function copyResult(turnId: string, field: CopyableSeoField, content: string) {
    if (!content)
      return

    await navigator.clipboard.writeText(content)
    const copyKey = buildCopyItemKey(turnId, field)

    copiedItemKey.value = copyKey

    window.setTimeout(() => {
      if (copiedItemKey.value === copyKey)
        copiedItemKey.value = null
    }, 1200)
  }

  function buildCopyItemKey(turnId: string, field: CopyableSeoField): string {
    return `${turnId}:${field}`
  }

  function createConversationTurnId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  watch(pageTopic, (value) => {
    if (value.trim())
      clearValidationError('pageTopic')
  })

  watch(() => keywords.value.length, (length) => {
    if (length > 0)
      clearValidationError('keywords')
  })

  return {
    pageTopic,
    language,
    keywordInput,
    keywords,
    status,
    lastGeneratedAt,
    copiedItemKey,
    errorMessage,
    validationErrors,
    appMessage,
    conversationTurns,
    pageTopicCharacterCount,
    completionPercent,
    statusCardTitle,
    statusCardDescription,
    addKeyword,
    removeKeyword,
    resetWorkspace,
    generateSeoContent,
    hideMessage,
    copyResult,
  }
}
