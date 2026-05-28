<script setup lang="ts">
import type { LucideIcon } from '@lucide/vue'

import {
  AlertCircle,
  BadgeCheck,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  Globe2,
  Home,
  Info,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  SearchCheck,
  Settings,
  Sparkles,
  Sun,
  TrendingUp,
  X,
} from '@lucide/vue'
import { computed, ref } from 'vue'

type GenerationStatus = 'empty' | 'loading' | 'success' | 'error'

interface NavigationItem {
  label: string
  icon: LucideIcon
  active?: boolean
}

interface SeoCheck {
  label: string
  detail: string
  pass: boolean
}

const navigationItems: NavigationItem[] = [
  { label: 'Workspace', icon: Home, active: true },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Documents', icon: FileText },
  { label: 'SEO Audit', icon: SearchCheck },
  { label: 'Links', icon: Link2 },
  { label: 'Trends', icon: TrendingUp },
  { label: 'Settings', icon: Settings },
]

const pageTopic = ref('PUBG UC 充值页面')
const language = ref('English')
const keywordInput = ref('')
const keywords = ref(['PUBG UC', 'Top up', 'cheap UC', 'instant delivery'])
const status = ref<GenerationStatus>('success')
const lastGeneratedAt = ref('14:32')
const copiedField = ref<'title' | 'description' | null>(null)
const errorMessage = ref('')

const seoTitle = ref('PUBG UC Top Up | Cheap UC with Instant Delivery | Secure & Best Prices')
const metaDescription = ref(
  'Top up PUBG UC securely and instantly. Best prices, 100% safe payments, fast delivery, and 24/7 support. Get cheap UC for PUBG Mobile now and enhance your gaming experience!',
)

const seoChecks = computed<SeoCheck[]>(() => {
  const lowerTitle = seoTitle.value.toLowerCase()
  const lowerDescription = metaDescription.value.toLowerCase()
  const normalizedKeywords = keywords.value.map(keyword => keyword.toLowerCase())
  const keywordIncluded = normalizedKeywords.some((keyword) => {
    return lowerTitle.includes(keyword) || lowerDescription.includes(keyword)
  })

  return [
    {
      label: 'Title length is appropriate',
      detail: 'Recommended: 50-60 characters',
      pass: seoTitle.value.length <= 70 && seoTitle.value.length >= 30,
    },
    {
      label: 'Description length is appropriate',
      detail: 'Recommended: 120-160 characters',
      pass: metaDescription.value.length <= 170 && metaDescription.value.length >= 80,
    },
    {
      label: 'Keywords included',
      detail: 'At least one target keyword appears in generated content',
      pass: keywordIncluded,
    },
  ]
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
    lastGeneratedAt.value = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())
    status.value = 'success'
  }, 720)
}

async function copyResult(field: 'title' | 'description', content: string) {
  if (!content)
    return

  await navigator.clipboard.writeText(content)
  copiedField.value = field

  window.setTimeout(() => {
    if (copiedField.value === field)
      copiedField.value = null
  }, 1200)
}
</script>

<template>
  <main class="min-h-screen w-full overflow-y-auto p-3 text-slate-950 xl:h-screen xl:overflow-hidden xl:p-3">
    <div class="grid min-h-0 w-full gap-3 lg:grid-cols-[76px_minmax(0,1fr)] xl:h-full">
      <aside class="hidden min-h-0 rounded-[28px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_18px_50px_rgb(25_39_78/10%)] backdrop-blur lg:flex lg:h-full lg:flex-col lg:items-center">
        <div class="mb-6 grid size-14 place-items-center rounded-[20px] bg-white shadow-[0_12px_30px_rgb(63_105_255/15%)]">
          <div class="relative size-8 rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500">
            <div class="absolute left-2 top-1.5 size-4 rounded-full bg-white/80" />
            <div class="absolute bottom-1.5 right-1.5 size-3 rounded-full bg-cyan-300/80" />
          </div>
        </div>

        <nav class="flex flex-1 flex-col items-center gap-3">
          <button
            v-for="item in navigationItems"
            :key="item.label"
            type="button"
            :title="item.label"
            :aria-label="item.label"
            class="grid size-12 place-items-center rounded-[16px] border transition"
            :class="item.active
              ? 'border-blue-100 bg-blue-50 text-blue-600 shadow-[0_12px_24px_rgb(37_99_235/12%)]'
              : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-blue-600'"
          >
            <component :is="item.icon" :size="22" />
          </button>
        </nav>

        <button
          type="button"
          title="Theme"
          aria-label="Theme"
          class="grid size-12 place-items-center rounded-[16px] bg-slate-100 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
        >
          <Sun :size="22" />
        </button>
      </aside>

      <div class="flex min-h-0 min-w-0 flex-col rounded-[28px] border border-slate-200/80 bg-white/55 p-4 shadow-[0_20px_70px_rgb(30_41_72/9%)] backdrop-blur-xl xl:h-full">
        <header class="mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div class="flex min-w-0 items-center gap-4">
            <div class="grid size-12 shrink-0 place-items-center rounded-[18px] bg-white shadow-[0_12px_30px_rgb(63_105_255/14%)] lg:hidden">
              <BrainCircuit class="text-blue-600" :size="25" />
            </div>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <h1 class="text-[27px] font-black leading-tight tracking-normal text-slate-950 sm:text-[31px]">
                  AI SEO Agent
                </h1>
                <span class="hidden h-7 w-px bg-slate-200 sm:block" />
                <p class="text-sm font-semibold text-slate-700 sm:text-base">
                  工作台
                </p>
                <p class="text-sm font-medium text-slate-500 sm:text-base">
                  SEO Workspace
                </p>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <div class="flex h-11 items-center gap-3 rounded-full border border-slate-200 bg-white/80 px-5 text-sm font-semibold text-slate-800 shadow-sm">
              <span class="size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgb(16_185_129/12%)]" />
              API: Connected
            </div>
            <div class="flex h-11 items-center gap-3 rounded-full border border-slate-200 bg-white/80 px-5 text-sm font-semibold text-slate-800 shadow-sm">
              <BadgeCheck class="text-blue-600" :size="21" />
              Model: GPT-5.5
            </div>
            <div class="grid size-11 place-items-center rounded-full bg-slate-700 text-lg font-bold text-white shadow-[0_10px_24px_rgb(15_23_42/20%)]">
              D
            </div>
          </div>
        </header>

        <section class="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(520px,0.95fr)_116px_minmax(640px,1.15fr)] 2xl:grid-cols-[minmax(640px,0.96fr)_132px_minmax(780px,1.18fr)]">
          <section class="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white/82 p-5 shadow-[0_22px_55px_rgb(31_42_68/8%)]">
            <div class="mb-5 flex shrink-0 items-start gap-3">
              <span class="mt-2 size-2.5 rounded-full bg-blue-600 shadow-[0_0_0_5px_rgb(37_99_235/12%)]" />
              <div>
                <h2 class="text-base font-black uppercase tracking-normal text-slate-950">
                  Input
                </h2>
                <p class="mt-1 text-sm font-medium text-slate-500">
                  Provide page details and target keywords
                </p>
              </div>
            </div>

            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
              <label class="block">
                <span class="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
                  Page Topic
                  <Info class="text-slate-400" :size="16" />
                </span>
                <span class="relative block">
                  <textarea
                    v-model="pageTopic"
                    maxlength="200"
                    rows="4"
                    class="min-h-28 w-full resize-none rounded-[16px] border border-slate-200 bg-white px-5 py-4 text-[15px] font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    placeholder="例如：PUBG UC 充值页面"
                  />
                  <span class="absolute bottom-4 right-5 text-sm font-semibold text-slate-400">
                    {{ pageTopicCharacterCount }} / 200
                  </span>
                </span>
              </label>

              <label class="block">
                <span class="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
                  Target Language
                  <Info class="text-slate-400" :size="16" />
                </span>
                <span class="relative block">
                  <Globe2 class="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-500" :size="22" />
                  <select
                    v-model="language"
                    class="h-12 w-full appearance-none rounded-[16px] border border-slate-200 bg-white px-14 text-[15px] font-semibold text-slate-700 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  >
                    <option>English</option>
                    <option>中文</option>
                    <option>日本語</option>
                    <option>Deutsch</option>
                  </select>
                  <ChevronDown class="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-slate-500" :size="20" />
                </span>
              </label>

              <div>
                <div class="mb-2 flex items-center gap-2 text-sm font-black text-slate-900">
                  Target Keywords
                  <Info class="text-slate-400" :size="16" />
                </div>

                <div class="flex flex-wrap gap-3">
                  <span
                    v-for="keyword in keywords"
                    :key="keyword"
                    class="inline-flex h-10 items-center gap-3 rounded-[12px] border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 shadow-sm"
                  >
                    {{ keyword }}
                    <button
                      type="button"
                      :aria-label="`Remove ${keyword}`"
                      :title="`Remove ${keyword}`"
                      class="text-slate-500 transition hover:text-rose-500"
                      @click="removeKeyword(keyword)"
                    >
                      <X :size="16" />
                    </button>
                  </span>

                  <label class="inline-flex h-10 min-w-44 items-center gap-2 rounded-[12px] border border-dashed border-transparent px-2 text-sm font-semibold text-slate-500 transition focus-within:border-blue-200 focus-within:bg-blue-50/60">
                    <Plus :size="18" />
                    <input
                      v-model="keywordInput"
                      class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
                      placeholder="Add keyword"
                      @keydown.enter.prevent="addKeyword"
                    >
                  </label>
                </div>
              </div>

              <div class="grid grid-cols-[minmax(0,1fr)_64px] gap-4">
                <button
                  type="button"
                  class="inline-flex h-12 items-center justify-center gap-3 rounded-[12px] bg-blue-600 px-6 text-sm font-black text-white shadow-[0_18px_34px_rgb(37_99_235/28%)] transition hover:bg-blue-500 disabled:bg-blue-400"
                  :disabled="status === 'loading'"
                  @click="generateSeoContent"
                >
                  <LoaderCircle v-if="status === 'loading'" class="animate-spin" :size="21" />
                  <Sparkles v-else :size="20" />
                  Generate SEO
                </button>
                <button
                  type="button"
                  title="Reset workspace"
                  aria-label="Reset workspace"
                  class="grid h-12 place-items-center rounded-[12px] border border-slate-200 bg-white text-slate-600 shadow-[0_12px_24px_rgb(15_23_42/8%)] transition hover:border-blue-200 hover:text-blue-600"
                  @click="resetWorkspace"
                >
                  <RefreshCw :size="22" />
                </button>
              </div>

              <div class="flex items-center gap-4 rounded-[18px] border border-slate-200 bg-white p-3 shadow-[0_14px_34px_rgb(30_41_72/8%)]">
                <div class="relative grid size-14 shrink-0 place-items-center rounded-[18px] bg-blue-50">
                  <div class="absolute inset-2 rounded-full border border-blue-200" />
                  <div class="absolute inset-4 rounded-full bg-gradient-to-br from-blue-500 to-cyan-300 shadow-[0_0_22px_rgb(59_130_246/42%)]" />
                  <div class="relative size-2 rounded-full bg-white" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="truncate text-sm font-black text-slate-900">
                      {{ statusCardTitle }}
                    </h3>
                    <span class="text-sm font-black text-blue-600">
                      {{ completionPercent }}%
                    </span>
                  </div>
                  <p class="mt-1 truncate text-sm font-medium text-slate-500">
                    {{ statusCardDescription }}
                  </p>
                  <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      class="h-full rounded-full bg-blue-600 transition-all duration-500"
                      :style="{ width: `${completionPercent}%` }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div class="relative hidden min-h-0 items-center justify-center xl:flex">
            <div class="absolute left-1/2 top-1/2 h-[68%] w-px -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-transparent via-blue-300/55 to-transparent" />
            <div class="absolute left-1/2 top-1/2 h-px w-[150px] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-blue-300/55 to-transparent" />
            <div class="absolute left-3 top-[28%] size-2 rounded-full bg-blue-500 shadow-[0_0_18px_rgb(59_130_246/70%)]" />
            <div class="absolute right-6 top-[18%] size-2 rounded-full bg-indigo-400" />
            <div class="absolute bottom-[18%] left-7 size-2 rounded-full bg-blue-500" />
            <div class="absolute bottom-[25%] right-3 size-2 rounded-full bg-cyan-400" />
            <div class="relative grid size-36 place-items-center">
              <div class="absolute inset-0 rounded-full border border-blue-100" />
              <div class="absolute inset-4 rounded-full border border-blue-200/80" />
              <div class="absolute inset-8 rounded-full border border-cyan-200/80" />
              <div class="absolute inset-1 rounded-full border border-dashed border-blue-200 animate-spin-slow" />
              <div class="absolute h-16 w-44 rounded-full border border-blue-200/80 animate-spin-slow" />
              <div class="absolute h-44 w-16 rounded-full border border-cyan-200/80 animate-spin-slow" />
              <div class="relative grid size-24 place-items-center rounded-full border border-white bg-gradient-to-br from-blue-600 via-indigo-500 to-cyan-300 shadow-[0_0_55px_rgb(37_99_235/42%)]">
                <BrainCircuit class="text-white" :size="36" />
              </div>
            </div>
          </div>

          <section class="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white/82 p-5 shadow-[0_22px_55px_rgb(31_42_68/8%)]">
            <div class="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="flex items-start gap-3">
                <span class="mt-2 size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgb(16_185_129/12%)]" />
                <div>
                  <h2 class="text-base font-black uppercase tracking-normal text-slate-950">
                    Results
                  </h2>
                  <p class="mt-1 text-sm font-medium text-slate-500">
                    AI-generated SEO content and checks
                  </p>
                </div>
              </div>

              <div class="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-500 shadow-sm">
                <Clock3 :size="18" />
                Last generated: {{ lastGeneratedAt }}
              </div>
            </div>

            <div v-if="status === 'empty'" class="grid min-h-0 flex-1 place-items-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
              <div>
                <div class="mx-auto mb-5 grid size-16 place-items-center rounded-[20px] bg-white text-blue-600 shadow-sm">
                  <Sparkles :size="28" />
                </div>
                <h3 class="text-lg font-black text-slate-900">
                  Empty
                </h3>
                <p class="mt-2 max-w-sm text-sm font-medium leading-6 text-slate-500">
                  Fill in page details and generate SEO content.
                </p>
              </div>
            </div>

            <div v-else class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              <div>
                <div class="mb-3 flex items-center justify-between gap-4">
                  <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
                    SEO Title
                    <Info class="text-slate-400" :size="16" />
                  </h3>
                  <p class="text-sm font-semibold text-slate-500">
                    <span class="font-black text-emerald-600">{{ titleCharacterCount }}</span>
                    / 60 characters
                  </p>
                </div>
                <div class="grid min-h-20 grid-cols-[minmax(0,1fr)_52px] items-center gap-4 rounded-[16px] border border-slate-200 bg-white px-5 py-3 shadow-sm">
                  <p class="text-[15px] font-semibold leading-7 text-slate-900">
                    {{ seoTitle || 'Waiting for generated title' }}
                  </p>
                  <button
                    type="button"
                    title="Copy SEO title"
                    aria-label="Copy SEO title"
                    class="grid size-11 place-items-center rounded-[14px] border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                    @click="copyResult('title', seoTitle)"
                  >
                    <Copy :size="22" />
                  </button>
                </div>
                <p v-if="copiedField === 'title'" class="mt-2 text-sm font-semibold text-blue-600">
                  Title copied
                </p>
              </div>

              <div>
                <div class="mb-3 flex items-center justify-between gap-4">
                  <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
                    Meta Description
                    <Info class="text-slate-400" :size="16" />
                  </h3>
                  <p class="text-sm font-semibold text-slate-500">
                    <span class="font-black text-emerald-600">{{ descriptionCharacterCount }}</span>
                    / 160 characters
                  </p>
                </div>
                <div class="grid min-h-28 grid-cols-[minmax(0,1fr)_52px] items-center gap-4 rounded-[16px] border border-slate-200 bg-white px-5 py-3 shadow-sm">
                  <p class="text-[15px] font-semibold leading-7 text-slate-900">
                    {{ metaDescription || 'Waiting for generated description' }}
                  </p>
                  <button
                    type="button"
                    title="Copy meta description"
                    aria-label="Copy meta description"
                    class="grid size-11 place-items-center rounded-[14px] border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                    @click="copyResult('description', metaDescription)"
                  >
                    <Copy :size="22" />
                  </button>
                </div>
                <p v-if="copiedField === 'description'" class="mt-2 text-sm font-semibold text-blue-600">
                  Description copied
                </p>
              </div>

              <div>
                <h3 class="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
                  SEO Checks
                  <Info class="text-slate-400" :size="16" />
                </h3>
                <div class="overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-sm">
                  <div
                    v-for="check in seoChecks"
                    :key="check.label"
                    class="grid grid-cols-[minmax(0,1fr)_82px_24px] items-center gap-4 border-b border-slate-100 px-5 py-3 last:border-b-0"
                  >
                    <div class="flex min-w-0 items-center gap-3">
                      <CheckCircle2
                        v-if="check.pass"
                        class="shrink-0 text-emerald-500"
                        :size="20"
                      />
                      <AlertCircle
                        v-else
                        class="shrink-0 text-rose-500"
                        :size="20"
                      />
                      <div class="min-w-0">
                        <p class="truncate text-sm font-semibold text-slate-900">
                          {{ check.label }}
                        </p>
                        <p class="mt-1 truncate text-xs font-medium text-slate-400">
                          {{ check.detail }}
                        </p>
                      </div>
                    </div>
                    <span
                      class="inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-black"
                      :class="check.pass ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'"
                    >
                      {{ check.pass ? 'Pass' : 'Fix' }}
                    </span>
                    <ChevronDown class="text-slate-500" :size="18" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </section>
      </div>
    </div>
  </main>
</template>
