import type { ApiErrorResponse } from '../api/http'
import type { CopyableSeoField, GenerateSeoResponse, GenerationStatus, SeoCheck } from '../types/seo'

import { isAxiosError } from 'axios'
import { computed, ref } from 'vue'

import { generateSeoContent as requestSeoContent } from '../api/seo'
import { formatGeneratedTime } from '../utils/seo-check'

export function useSeoWorkspace() {
  const pageTopic = ref('PUBG UC 充值页面')
  const language = ref('English')
  const keywordInput = ref('')
  const keywords = ref(['PUBG UC', 'Top up', 'cheap UC', 'instant delivery'])
  const status = ref<GenerationStatus>('empty')
  const lastGeneratedAt = ref('--:--')
  const copiedField = ref<CopyableSeoField | null>(null)
  const errorMessage = ref('')

  const seoTitle = ref('')
  const metaDescription = ref('')

  const seoChecks = ref<SeoCheck[]>([])

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
    seoChecks.value = []
    status.value = 'empty'
    errorMessage.value = ''
    copiedField.value = null
  }

  async function generateSeoContent() {
    if (!pageTopic.value.trim()) {
      status.value = 'error'
      errorMessage.value = 'Please enter a page topic before generating SEO content.'
      return
    }

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
    }
  }

  function applySeoResult(result: GenerateSeoResponse) {
    seoTitle.value = result.title
    metaDescription.value = result.description
    seoChecks.value = result.checks
    lastGeneratedAt.value = formatGeneratedTime(new Date(result.generatedAt))
  }

  function getGenerateErrorMessage(error: unknown): string {
    if (!isAxiosError<ApiErrorResponse>(error)) {
      return 'Failed to generate SEO content. Please try again.'
    }

    const responseData = error.response?.data
    const details = responseData?.error.details

    if (Array.isArray(details) && details.length > 0) {
      return String(details[0])
    }

    return responseData?.message ?? 'Failed to generate SEO content. Please try again.'
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

  return {
    pageTopic,
    language,
    keywordInput,
    keywords,
    status,
    lastGeneratedAt,
    copiedField,
    errorMessage,
    seoTitle,
    metaDescription,
    seoChecks,
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
    copyResult,
  }
}
