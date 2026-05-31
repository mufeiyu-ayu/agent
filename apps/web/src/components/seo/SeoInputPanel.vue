<script setup lang="ts">
import type { GenerationStatus, SeoInputValidationErrors } from '../../types/seo'

import { ChevronDown, Globe2, Info, LoaderCircle, Plus, RefreshCw, Sparkles, X } from '@lucide/vue'
import { computed } from 'vue'

import SeoStatusCard from './SeoStatusCard.vue'

const props = defineProps<{
  pageTopic: string
  language: string
  keywordInput: string
  keywords: string[]
  status: GenerationStatus
  pageTopicCharacterCount: number
  statusCardTitle: string
  statusCardDescription: string
  completionPercent: number
  validationErrors: SeoInputValidationErrors
}>()

const emit = defineEmits<{
  'update:pageTopic': [value: string]
  'update:language': [value: string]
  'update:keywordInput': [value: string]
  'addKeyword': []
  'removeKeyword': [keyword: string]
  'generate': []
  'reset': []
}>()

const pageTopicModel = computed({
  get: () => props.pageTopic,
  set: value => emit('update:pageTopic', value),
})

const languageModel = computed({
  get: () => props.language,
  set: value => emit('update:language', value),
})

const keywordInputModel = computed({
  get: () => props.keywordInput,
  set: value => emit('update:keywordInput', value),
})

const pageTopicInputClass = computed(() => {
  if (props.validationErrors.pageTopic)
    return 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'

  return 'border-slate-200 focus:border-blue-400 focus:ring-blue-100'
})

const keywordGroupClass = computed(() => {
  if (props.validationErrors.keywords)
    return 'border-rose-300 bg-rose-50/30'

  return 'border-transparent focus-within:border-blue-200 focus-within:bg-blue-50/60'
})
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden p-5">
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
            v-model="pageTopicModel"
            maxlength="200"
            rows="4"
            class="min-h-28 w-full resize-none rounded-[16px] border bg-white px-5 py-4 text-[15px] font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4"
            :class="pageTopicInputClass"
            :aria-invalid="Boolean(validationErrors.pageTopic)"
            aria-describedby="page-topic-error"
            placeholder="例如：PUBG UC 充值页面"
          />
          <span class="absolute bottom-4 right-5 text-sm font-semibold text-slate-400">
            {{ pageTopicCharacterCount }} / 200
          </span>
        </span>
        <span
          v-if="validationErrors.pageTopic"
          id="page-topic-error"
          class="mt-2 block text-sm font-semibold text-rose-600"
        >
          {{ validationErrors.pageTopic }}
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
            v-model="languageModel"
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

        <div
          class="rounded-[16px] border p-2 transition"
          :class="keywordGroupClass"
        >
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
                @click="emit('removeKeyword', keyword)"
              >
                <X :size="16" />
              </button>
            </span>

            <label class="inline-flex h-10 min-w-44 items-center gap-2 rounded-[12px] border border-dashed border-transparent px-2 text-sm font-semibold text-slate-500 transition">
              <Plus :size="18" />
              <input
                v-model="keywordInputModel"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
                :aria-invalid="Boolean(validationErrors.keywords)"
                aria-describedby="keywords-error"
                placeholder="Add keyword"
                @keydown.enter.prevent="emit('addKeyword')"
              >
            </label>
          </div>
        </div>
        <p
          v-if="validationErrors.keywords"
          id="keywords-error"
          class="mt-2 text-sm font-semibold text-rose-600"
        >
          {{ validationErrors.keywords }}
        </p>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_64px] gap-4">
        <button
          type="button"
          class="inline-flex h-12 items-center justify-center gap-3 rounded-[12px] bg-blue-600 px-6 text-sm font-black text-white shadow-[0_18px_34px_rgb(37_99_235/28%)] transition hover:bg-blue-500 disabled:bg-blue-400"
          :disabled="status === 'loading'"
          @click="emit('generate')"
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
          @click="emit('reset')"
        >
          <RefreshCw :size="22" />
        </button>
      </div>

      <SeoStatusCard
        :title="statusCardTitle"
        :description="statusCardDescription"
        :completion-percent="completionPercent"
      />
    </div>
  </section>
</template>
