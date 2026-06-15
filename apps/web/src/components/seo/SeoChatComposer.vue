<script setup lang="ts">
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus, SeoInputValidationErrors } from '../../types/seo'

import { Bot, LoaderCircle, RefreshCw, Send, Sparkles } from '@lucide/vue'
import { computed } from 'vue'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

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

function updateMessage(value: string | number) {
  emit('update:message', String(value))
}

function updateSelectedModel(value: unknown) {
  const nextModel = props.models.find(model => model.id === value)

  if (!nextModel)
    return

  emit('update:selectedModel', nextModel.id)
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

        <Textarea
          :model-value="message"
          maxlength="2000"
          rows="3"
          class="max-h-44 min-h-20 resize-none border-0 bg-transparent px-1 py-0 text-[15px] font-medium leading-6 text-slate-900 shadow-none focus-visible:ring-0 placeholder:font-medium placeholder:text-slate-400"
          :aria-invalid="Boolean(validationErrors.message)"
          aria-describedby="message-error"
          placeholder="直接输入你想让 SEO Agent 分析的问题..."
          @update:model-value="updateMessage"
          @keydown.enter.exact.prevent="submitComposer"
        />

        <div class="flex flex-col gap-3 pt-2 md:flex-row md:items-center md:justify-between">
          <Select
            :model-value="selectedModel"
            @update:model-value="updateSelectedModel"
          >
            <SelectTrigger
              aria-label="DeepSeek model"
              class="h-10 min-w-[210px] rounded-xl border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:border-blue-200 focus:ring-blue-100"
            >
              <Bot class="mr-1 text-slate-500" :size="17" />
              <SelectValue placeholder="DeepSeek model" />
            </SelectTrigger>
            <SelectContent class="min-w-[210px] rounded-xl">
              <SelectItem
                v-for="model in models"
                :key="model.id"
                :value="model.id"
              >
                {{ model.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <div class="flex shrink-0 items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              title="Reset conversation"
              aria-label="Reset conversation"
              class="size-10 rounded-xl border-slate-200 text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
              @click="emit('reset')"
            >
              <RefreshCw :size="19" />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              title="Send message"
              aria-label="Send message"
              class="size-11 rounded-xl bg-blue-600 text-white shadow-[0_12px_26px_rgb(37_99_235/26%)] hover:bg-blue-500 disabled:bg-blue-400"
              :disabled="status === 'loading'"
              @click="submitComposer"
            >
              <LoaderCircle v-if="status === 'loading'" class="animate-spin" :size="20" />
              <Send v-else :size="19" />
            </Button>
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
