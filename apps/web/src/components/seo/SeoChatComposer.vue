<script setup lang="ts">
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus, SeoInputValidationErrors } from '../../types/seo'

import { ArrowUp, LoaderCircle, RotateCcw } from '@lucide/vue'
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

  return 'border-slate-200 focus-within:border-slate-300 focus-within:ring-slate-100'
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
  <section class="relative z-10 shrink-0 border-t border-slate-100 bg-gradient-to-t from-white via-white to-white/90 px-3 pb-3 pt-4 shadow-[0_-8px_24px_rgb(148_163_184/10%)] sm:px-4 sm:pb-4 sm:pt-5">
    <div class="mx-auto w-full max-w-[920px]">
      <div
        class="rounded-[24px] border bg-white p-2 shadow-[0_8px_22px_rgb(15_23_42/8%)] transition focus-within:ring-4 sm:rounded-[28px] sm:p-3"
        :class="messageInputClass"
      >
        <Textarea
          :model-value="message"
          maxlength="2000"
          rows="1"
          class="max-h-40 min-h-[72px] resize-none border-0 bg-transparent px-3 pb-2 pt-2 text-[15px] font-normal leading-6 text-slate-900 shadow-none focus-visible:ring-0 sm:min-h-24 sm:px-4 sm:pt-3 placeholder:font-normal placeholder:text-slate-400"
          :aria-invalid="Boolean(validationErrors.message)"
          aria-describedby="message-error"
          placeholder="直接输入你想让 SEO Agent 分析的问题..."
          @update:model-value="updateMessage"
          @keydown.enter.exact.prevent="submitComposer"
        />

        <div class="flex items-center justify-between gap-2 pt-1">
          <Select
            :model-value="selectedModel"
            @update:model-value="updateSelectedModel"
          >
            <SelectTrigger
              aria-label="DeepSeek model"
              class="h-9 max-w-[calc(100vw-148px)] min-w-0 overflow-hidden rounded-full border-slate-200 bg-slate-50/70 px-3 text-[14px] font-medium tracking-normal text-slate-700 shadow-none hover:border-slate-300 hover:bg-white focus:ring-slate-100 sm:h-10 sm:max-w-none sm:min-w-[210px]"
            >
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

          <div class="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            <span class="hidden text-xs font-bold text-slate-400 sm:inline">
              {{ messageCharacterCount }} / 2000
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              title="Reset conversation"
              aria-label="Reset conversation"
              class="size-9 rounded-full border-slate-200 bg-white text-slate-500 shadow-none hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 sm:size-10"
              @click="emit('reset')"
            >
              <RotateCcw :size="17" />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              title="Send message"
              aria-label="Send message"
              class="size-10 rounded-full bg-slate-950 text-white shadow-[0_10px_22px_rgb(15_23_42/22%)] hover:bg-slate-800 disabled:bg-slate-300 sm:size-11"
              :disabled="status === 'loading'"
              @click="submitComposer"
            >
              <LoaderCircle v-if="status === 'loading'" class="animate-spin" :size="19" />
              <ArrowUp v-else :size="19" stroke-width="2.4" />
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
