import type { ApiErrorResponse } from '../api/http'
import type { AppMessageState, AppMessageType, CopyableSeoField, GenerateSeoResponse, GenerationStatus, SeoInputValidationErrors } from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, ref, watch } from 'vue'

import { generateSeoContent as requestSeoContent } from '../api/seo'
import { formatGeneratedTime } from '../utils/seo-format'

const GENERATE_REQUEST_INTERVAL_MS = 800

export function useSeoWorkspace() {
  const pageTopic = ref('PUBG UC 充值页面')
  const language = ref('English')
  const keywordInput = ref('')
  const keywords = ref(['PUBG UC', 'Top up', 'cheap UC', 'instant delivery'])
  const status = ref<GenerationStatus>('empty')
  const lastGeneratedAt = ref('--:--')
  const copiedField = ref<CopyableSeoField | null>(null)
  const errorMessage = ref('')
  const validationErrors = ref<SeoInputValidationErrors>({})
  const appMessage = ref<AppMessageState>({
    visible: false,
    type: 'info',
    text: '',
  })
  let messageTimer: number | undefined
  let lastGenerateRequestedAt = 0

  const seoTitle = ref('')
  const metaDescription = ref('')
  const seoSuggestions = ref<string[]>([])

  const titleCharacterCount = computed(() => seoTitle.value.length)
  const descriptionCharacterCount = computed(() => metaDescription.value.length)
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
    seoTitle.value = ''
    metaDescription.value = ''
    seoSuggestions.value = []
    status.value = 'empty'
    errorMessage.value = ''
    validationErrors.value = {}
    hideMessage()
    copiedField.value = null
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

    status.value = 'loading'
    errorMessage.value = ''

    try {
      const result = await requestSeoContent({
        pageTopic: pageTopic.value,
        language: language.value,
        keywords: keywords.value,
      })

      applySeoResult(result)
      status.value = 'success'
    }
    catch (error) {
      status.value = 'error'
      errorMessage.value = getGenerateErrorMessage(error)
      showMessage(errorMessage.value, 'error')
    }
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

  function applySeoResult(result: GenerateSeoResponse) {
    seoTitle.value = result.title
    metaDescription.value = result.description
    seoSuggestions.value = result.suggestions
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

  async function copyResult(field: CopyableSeoField, content: string) {
    if (!content)
      return

    await navigator.clipboard.writeText(content)
    copiedField.value = field

    window.setTimeout(() => {
      if (copiedField.value === field)
        copiedField.value = null
    }, 1200)
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
    copiedField,
    errorMessage,
    validationErrors,
    appMessage,
    seoTitle,
    metaDescription,
    seoSuggestions,
    titleCharacterCount,
    descriptionCharacterCount,
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
