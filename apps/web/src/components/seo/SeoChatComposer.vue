<script setup lang="ts">
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus, SeoInputValidationErrors } from '../../types/seo'

import { Bot, ChevronDown, LoaderCircle, RefreshCw, Send, Sparkles } from '@lucide/vue'
import { computed } from 'vue'

const props = defineProps<{
  message: string
  models: LlmModelOption[]
  selectedModel: LlmModelOption['id']
  status: GenerationStatus
  messageCharacterCount: number
  validationErrors: SeoInputValidationErrors
}>()

const emit = defineEmits<{
  'update:message': [value: string]
  'update:selectedModel': [value: LlmModelOption['id']]
  'send': []
  'reset': []
}>()

const messageModel = computed({
  get: () => props.message,
  set: value => emit('update:message', value),
})

const selectedModelModel = computed({
  get: () => props.selectedModel,
  set: value => emit('update:selectedModel', value),
})

const messageInputClass = computed(() => {
  if (props.validationErrors.message)
    return 'border-rose-300 focus-within:border-rose-400 focus-within:ring-rose-100'

  return 'border-slate-200 focus-within:border-blue-300 focus-within:ring-blue-100'
})

function submitComposer() {
  if (props.status === 'loading')
    return

  emit('send')
}
</script>

<template>
  <section class="shrink-0 bg-white px-4 pb-4 pt-3">
    <div class="mx-auto w-full max-w-[920px]">
      <div
        class="rounded-2xl border bg-white p-3 shadow-[0_18px_44px_rgb(15_23_42/12%)] transition focus-within:ring-4"
        :class="messageInputClass"
      >
        <div class="mb-2 flex items-center justify-between gap-3">
          <div class="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 text-sm font-black text-slate-700">
            <Sparkles :size="18" />
            SEO Agent
          </div>

          <span class="text-xs font-bold text-slate-400">
            {{ messageCharacterCount }} / 2000
          </span>
        </div>

        <textarea
          v-model="messageModel"
          maxlength="2000"
          rows="3"
          class="max-h-44 min-h-20 w-full resize-none bg-transparent px-1 text-[15px] font-semibold leading-6 text-slate-900 outline-none placeholder:text-slate-400"
          :aria-invalid="Boolean(validationErrors.message)"
          aria-describedby="message-error"
          placeholder="Ask your SEO Agent anything..."
          @keydown.enter.exact.prevent="submitComposer"
        />

        <div class="flex flex-col gap-3 pt-2 md:flex-row md:items-center md:justify-between">
          <label class="relative h-10 min-w-[210px]">
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

          <div class="flex shrink-0 items-center justify-end gap-2">
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
        v-if="validationErrors.message"
        id="message-error"
        class="mt-2 px-1 text-sm font-semibold text-rose-600"
      >
        {{ validationErrors.message }}
      </p>
    </div>
  </section>
</template>
