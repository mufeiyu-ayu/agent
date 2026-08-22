<script setup lang="ts">
import type { DeepSeekReasoningEffort } from '@agent/contracts'
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus } from '../../types/seo'

import {
  DEEPSEEK_REASONING_EFFORTS,
  SEO_CHAT_MESSAGE_MAX_CHARS,
} from '@agent/contracts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
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
  hasConversation: boolean
  models: LlmModelOption[]
  selectedModel: LlmModelOption['id']
  selectedReasoningEffort: DeepSeekReasoningEffort
  status: GenerationStatus
  messageCharacterCount: number
}>()

const emit = defineEmits<{
  'update:message': [value: string]
  'update:selectedModel': [value: LlmModelOption['id']]
  'update:selectedReasoningEffort': [value: DeepSeekReasoningEffort]
  'send': []
  'reset': []
  'stop': []
}>()

const { t } = useI18n()

const canReset = computed(() => {
  return props.hasConversation || props.message.trim().length > 0
})

const isGenerationInProgress = computed(() => {
  return props.status === 'thinking' || props.status === 'generating'
})

function submitComposer() {
  if (isGenerationInProgress.value || !props.message.trim())
    return

  emit('send')
}

function triggerPrimaryAction() {
  if (isGenerationInProgress.value) {
    emit('stop')
    return
  }

  submitComposer()
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

function updateSelectedReasoningEffort(value: unknown) {
  if (!DEEPSEEK_REASONING_EFFORTS.includes(value as DeepSeekReasoningEffort))
    return

  emit('update:selectedReasoningEffort', value as DeepSeekReasoningEffort)
}
</script>

<template>
  <section class="relative z-10 shrink-0 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
    <div class="mx-auto w-full max-w-[700px]">
      <div
        class="rounded-2xl border border-agent-border bg-agent-surface-raised p-2.5 shadow-[0_4px_8px_rgb(61_49_36/5%)]"
      >
        <Textarea
          :model-value="message"
          :maxlength="SEO_CHAT_MESSAGE_MAX_CHARS"
          rows="1"
          class="max-h-40 min-h-16 resize-none border-0 bg-transparent px-3 pb-2 pt-2 text-base font-medium leading-6 text-agent-ink shadow-none focus-visible:ring-0 min-[960px]:min-h-20 min-[960px]:text-[15px] sm:px-4 sm:pt-3 placeholder:font-medium placeholder:text-agent-ink-muted"
          :placeholder="hasConversation ? '' : t('composer.placeholder')"
          @update:model-value="updateMessage"
          @keydown.enter.exact.prevent="submitComposer"
        />

        <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div class="flex min-w-0 flex-1 basis-[230px] items-center gap-2">
            <Select
              :model-value="selectedModel"
              @update:model-value="updateSelectedModel"
            >
              <SelectTrigger
                :aria-label="t('composer.modelSelectAria')"
                class="h-11 min-w-0 flex-1 overflow-hidden rounded-full border-agent-border bg-agent-surface px-3 text-[14px] font-medium tracking-normal text-agent-ink-soft shadow-none hover:border-agent-border hover:bg-agent-surface-raised focus:ring-agent-focus/35 min-[960px]:h-9"
              >
                <SelectValue :placeholder="t('composer.modelPlaceholder')" />
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

            <Select
              :model-value="selectedReasoningEffort"
              @update:model-value="updateSelectedReasoningEffort"
            >
              <SelectTrigger
                :aria-label="t('composer.reasoningEffortSelectAria')"
                class="h-11 w-[94px] shrink-0 rounded-full border-agent-border bg-agent-surface px-3 text-[14px] font-medium text-agent-ink-soft shadow-none hover:border-agent-border hover:bg-agent-surface-raised focus:ring-agent-focus/35 min-[960px]:h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent class="min-w-[120px] rounded-xl">
                <SelectItem
                  v-for="effort in DEEPSEEK_REASONING_EFFORTS"
                  :key="effort"
                  :value="effort"
                >
                  {{ t(`composer.reasoningEffort.${effort}`) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            <span class="hidden text-xs font-bold text-agent-ink-muted sm:inline">
              {{ messageCharacterCount }} / {{ SEO_CHAT_MESSAGE_MAX_CHARS }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              :title="t('composer.reset')"
              :aria-label="t('composer.reset')"
              class="size-11 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken hover:text-agent-ink disabled:text-agent-ink-faint min-[960px]:size-10"
              :disabled="!canReset || isGenerationInProgress"
              @click="emit('reset')"
            >
              <AppIcon name="tabler:rotate-clockwise" :size="18" />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              :title="isGenerationInProgress ? t('composer.stop') : t('composer.send')"
              :aria-label="isGenerationInProgress ? t('composer.stop') : t('composer.send')"
              class="size-11 rounded-full text-white shadow-none disabled:bg-agent-border min-[960px]:size-10"
              :class="isGenerationInProgress ? 'bg-agent-copper hover:bg-agent-copper' : 'bg-agent-primary hover:bg-agent-primary-hover'"
              :disabled="!isGenerationInProgress && !message.trim()"
              @click="triggerPrimaryAction"
            >
              <AppIcon v-if="isGenerationInProgress" name="tabler:player-stop" :size="19" />
              <AppIcon v-else name="tabler:arrow-up" :size="20" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
