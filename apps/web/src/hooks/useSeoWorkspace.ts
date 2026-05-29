import type { CopyableSeoField, GenerationStatus, SeoCheck } from '../types/seo'

import { computed, ref } from 'vue'

import { buildSeoChecks, formatGeneratedTime } from '../utils/seo-check'

export function useSeoWorkspace() {
  const pageTopic = ref('PUBG UC 充值页面')
  const language = ref('English')
  const keywordInput = ref('')
  const keywords = ref(['PUBG UC', 'Top up', 'cheap UC', 'instant delivery'])
  const status = ref<GenerationStatus>('success')
  const lastGeneratedAt = ref('14:32')
  const copiedField = ref<CopyableSeoField | null>(null)
  const errorMessage = ref('')

  const seoTitle = ref('PUBG UC Top Up | Cheap UC with Instant Delivery | Secure & Best Prices')
  const metaDescription = ref(
    'Top up PUBG UC securely and instantly. Best prices, 100% safe payments, fast delivery, and 24/7 support. Get cheap UC for PUBG Mobile now and enhance your gaming experience!',
  )

  const seoChecks = computed<SeoCheck[]>(() => {
    return buildSeoChecks(seoTitle.value, metaDescription.value, keywords.value)
  })

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
    status.value = 'empty'
    errorMessage.value = ''
    copiedField.value = null
  }

  function generateSeoContent() {
    if (!pageTopic.value.trim()) {
      status.value = 'error'
      errorMessage.value = 'Please enter a page topic before generating SEO content.'
      return
    }

    status.value = 'loading'
    errorMessage.value = ''

    window.setTimeout(() => {
      const primaryKeyword = keywords.value[0] ?? 'SEO'

      seoTitle.value = `${primaryKeyword} Top Up | Cheap UC with Instant Delivery | Secure & Best Prices`
      metaDescription.value = `Top up ${primaryKeyword} securely and instantly. Best prices, 100% safe payments, fast delivery, and 24/7 support. Get cheap UC for PUBG Mobile now and enhance your gaming experience!`
      lastGeneratedAt.value = formatGeneratedTime(new Date())
      status.value = 'success'
    }, 720)
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
