import type { ApiErrorResponse } from '../api/http'
import type { AppMessageState, AppMessageType, CopyableSeoField, GenerateSeoRequest, GenerateSeoResponse, GenerationStatus, SeoConversationTurn, SeoInputValidationErrors, SeoStreamEvent } from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, ref, watch } from 'vue'

import { streamGenerateSeoContent as requestSeoContentStream } from '../api/seo'
import { formatGeneratedTime } from '../utils/seo-format'

const GENERATE_REQUEST_INTERVAL_MS = 800
const MAX_CONVERSATION_TURNS = 8
const STREAM_PROGRESS_STEP_DELAY_MS = 520
const STREAM_RESULT_REVEAL_DELAY_MS = 650
const STREAM_FINAL_PROGRESS_MESSAGE = 'Preparing final answer'

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
  let activeGenerationTurnId: string | null = null

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
    activeGenerationTurnId = null
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
    const streamRevealController = createSeoStreamRevealController(turnId)

    activeGenerationTurnId = turnId
    status.value = 'loading'
    errorMessage.value = ''

    try {
      await requestSeoContentStream(request, {
        onEvent: event => streamRevealController.handleEvent(event),
      })
      await streamRevealController.revealResult()
    }
    catch (error) {
      streamRevealController.cancel()

      if (!isActiveGenerationTurn(turnId))
        return

      const nextErrorMessage = getGenerateErrorMessage(error)

      status.value = 'error'
      errorMessage.value = nextErrorMessage
      updateConversationTurn(turnId, {
        status: 'error',
        progressMessage: undefined,
        errorMessage: nextErrorMessage,
      })
      showMessage(errorMessage.value, 'error')
      activeGenerationTurnId = null
    }
  }

  function createSeoStreamRevealController(turnId: string) {
    let active = true
    let lastDisplayedMessage = ''
    let pendingResult: GenerateSeoResponse | null = null
    let progressChain = Promise.resolve()

    function canUpdateTurn(): boolean {
      return active && isActiveGenerationTurn(turnId)
    }

    function enqueueProgressMessage(message: string) {
      progressChain = progressChain.then(async () => {
        if (!canUpdateTurn() || message === lastDisplayedMessage)
          return

        if (lastDisplayedMessage) {
          await wait(STREAM_PROGRESS_STEP_DELAY_MS)
        }

        if (!canUpdateTurn())
          return

        lastDisplayedMessage = message
        updateConversationTurn(turnId, {
          status: 'loading',
          progressMessage: message,
        })
      })
    }

    return {
      cancel() {
        active = false
      },
      handleEvent(event: SeoStreamEvent) {
        if (!canUpdateTurn())
          return

        if (event.type === 'started' || event.type === 'progress') {
          enqueueProgressMessage(event.message)
          return
        }

        if (event.type === 'result') {
          pendingResult = event.data
          return
        }

        if (event.type === 'error') {
          active = false
          applySeoStreamError(turnId, event.message)
        }
      },
      async revealResult() {
        await progressChain

        if (!canUpdateTurn())
          return

        if (!pendingResult) {
          throw new Error('AI 返回结果异常，请重试')
        }

        enqueueProgressMessage(STREAM_FINAL_PROGRESS_MESSAGE)
        await progressChain
        await wait(STREAM_RESULT_REVEAL_DELAY_MS)

        if (!canUpdateTurn())
          return

        applySeoResult(turnId, pendingResult)
        status.value = 'success'
        active = false
        activeGenerationTurnId = null
      },
    }
  }

  function applySeoStreamError(turnId: string, message: string) {
    if (!isActiveGenerationTurn(turnId))
      return

    status.value = 'error'
    errorMessage.value = message
    updateConversationTurn(turnId, {
      status: 'error',
      progressMessage: undefined,
      errorMessage: message,
    })
    showMessage(message, 'error')
    activeGenerationTurnId = null
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
        progressMessage: 'Waiting for stream connection',
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
      progressMessage: undefined,
      errorMessage: undefined,
    })
    lastGeneratedAt.value = formatGeneratedTime(new Date(result.generatedAt))
  }

  function isActiveGenerationTurn(turnId: string): boolean {
    return activeGenerationTurnId === turnId
  }

  function wait(duration: number): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(resolve, duration)
    })
  }

  function getGenerateErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }

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
