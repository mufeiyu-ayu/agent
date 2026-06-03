<script setup lang="ts">
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus, SeoInputValidationErrors } from '../../types/seo'

import { Bot, ChevronDown, LoaderCircle, Paperclip, RefreshCw, Send, Settings2, Wand2 } from '@lucide/vue'
import { computed, ref } from 'vue'

import SeoContextTags from './SeoContextTags.vue'
import SeoTemplatePanel from './SeoTemplatePanel.vue'

const props = defineProps<{
  instruction: string
  pageTopic: string
  keywordInput: string
  keywords: string[]
  models: LlmModelOption[]
  selectedModel: LlmModelOption['id']
  status: GenerationStatus
  instructionCharacterCount: number
  validationErrors: SeoInputValidationErrors
}>()

const emit = defineEmits<{
  'update:instruction': [value: string]
  'update:pageTopic': [value: string]
  'update:keywordInput': [value: string]
  'update:selectedModel': [value: LlmModelOption['id']]
  'addKeyword': []
  'removeKeyword': [keyword: string]
  'generate': []
  'reset': []
}>()

const templateOpen = ref(false)

const instructionModel = computed({
  get: () => props.instruction,
  set: value => emit('update:instruction', value),
})

const selectedModelModel = computed({
  get: () => props.selectedModel,
  set: value => emit('update:selectedModel', value),
})

const instructionInputClass = computed(() => {
  if (props.validationErrors.instruction)
    return 'border-rose-300 focus-within:border-rose-400 focus-within:ring-rose-100'

  return 'border-slate-200 focus-within:border-blue-300 focus-within:ring-blue-100'
})

function submitComposer() {
  if (props.status === 'loading')
    return

  emit('generate')
}
</script>

<template>
  <section class="shrink-0 bg-white px-4 pb-4 pt-3">
    <div class="mx-auto w-full max-w-[1120px]">
      <SeoTemplatePanel
        v-if="templateOpen"
        :page-topic="pageTopic"
        :keyword-input="keywordInput"
        :keywords="keywords"
        class="mb-3"
        @update:page-topic="value => emit('update:pageTopic', value)"
        @update:keyword-input="value => emit('update:keywordInput', value)"
        @add-keyword="emit('addKeyword')"
        @remove-keyword="keyword => emit('removeKeyword', keyword)"
        @close="templateOpen = false"
      />

      <div
        class="rounded-2xl border bg-white p-3 shadow-[0_18px_44px_rgb(15_23_42/12%)] transition focus-within:ring-4"
        :class="instructionInputClass"
      >
        <div class="mb-2 flex items-center justify-between gap-3">
          <button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-black text-slate-700 transition hover:bg-blue-50 hover:text-blue-600"
          >
            <Wand2 :size="18" />
            SEO Generate
            <ChevronDown :size="17" />
          </button>

          <span class="text-xs font-bold text-slate-400">
            {{ instructionCharacterCount }} / 500
          </span>
        </div>

        <textarea
          v-model="instructionModel"
          maxlength="500"
          rows="2"
          class="max-h-36 min-h-14 w-full resize-none bg-transparent px-1 text-[15px] font-semibold leading-6 text-slate-900 outline-none placeholder:text-slate-400"
          :aria-invalid="Boolean(validationErrors.instruction)"
          aria-describedby="instruction-error"
          placeholder="Describe what you want to generate or refine..."
          @keydown.enter.exact.prevent="submitComposer"
        />

        <div class="flex flex-col gap-3 pt-2 md:flex-row md:items-center md:justify-between">
          <SeoContextTags
            :keywords="keywords"
          />

          <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <label class="relative h-10 min-w-[186px]">
              <Bot class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" :size="17" />
              <select
                v-model="selectedModelModel"
                aria-label="DeepSeek model"
                class="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white py-0 pl-9 pr-8 text-sm font-bold text-slate-700 outline-none transition hover:border-blue-200 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
              >
                <option
                  v-for="model in models"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.label }}
                </option>
              </select>
              <ChevronDown class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" :size="16" />
            </label>

            <button
              type="button"
              class="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-black text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
              :class="{ 'border-blue-200 bg-blue-50 text-blue-600': templateOpen }"
              @click="templateOpen = !templateOpen"
            >
              <Settings2 :size="18" />
              Template
            </button>
            <button
              type="button"
              title="Attach context"
              aria-label="Attach context"
              class="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
            >
              <Paperclip :size="18" />
            </button>
            <button
              type="button"
              title="Reset conversation"
              aria-label="Reset conversation"
              class="grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
              @click="emit('reset')"
            >
              <RefreshCw :size="19" />
            </button>
            <button
              type="button"
              title="Send message"
              aria-label="Send message"
              class="grid size-11 place-items-center rounded-xl bg-blue-600 text-white shadow-[0_12px_26px_rgb(37_99_235/26%)] transition hover:bg-blue-500 disabled:bg-blue-400"
              :disabled="status === 'loading'"
              @click="submitComposer"
            >
              <LoaderCircle v-if="status === 'loading'" class="animate-spin" :size="20" />
              <Send v-else :size="19" />
            </button>
          </div>
        </div>
      </div>

      <p
        v-if="validationErrors.instruction"
        id="instruction-error"
        class="mt-2 px-1 text-sm font-semibold text-rose-600"
      >
        {{ validationErrors.instruction }}
      </p>
    </div>
  </section>
</template>
