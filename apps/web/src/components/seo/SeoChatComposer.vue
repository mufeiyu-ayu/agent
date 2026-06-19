<script setup lang="ts">
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus, SeoInputValidationErrors } from '../../types/seo'

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

const { t } = useI18n()

const messageInputClass = computed(() => {
  if (props.validationErrors.message)
    return 'border-rose-300 focus-within:border-rose-400 focus-within:ring-rose-100'

  return 'border-agent-border focus-within:border-agent-border focus-within:ring-agent-focus/35'
})

const canReset = computed(() => {
  return props.hasConversation || props.message.trim().length > 0
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
  <section class="relative z-10 shrink-0 px-3 pb-3 pt-4 sm:px-4 sm:pb-4 sm:pt-5">
    <div class="mx-auto w-full max-w-[760px]">
      <div
        class="rounded-2xl border bg-agent-surface-raised p-2 shadow-[0_4px_8px_rgb(61_49_36/5%)] transition focus-within:ring-4 sm:p-3"
        :class="messageInputClass"
      >
        <Textarea
          :model-value="message"
          maxlength="2000"
          rows="1"
          class="max-h-40 min-h-[72px] resize-none border-0 bg-transparent px-3 pb-2 pt-2 text-[15px] font-medium leading-6 text-agent-ink shadow-none focus-visible:ring-0 sm:min-h-24 sm:px-4 sm:pt-3 placeholder:font-medium placeholder:text-agent-ink-muted"
          :aria-invalid="Boolean(validationErrors.message)"
          :aria-describedby="validationErrors.message ? 'message-error' : undefined"
          :placeholder="t('composer.placeholder')"
          @update:model-value="updateMessage"
          @keydown.enter.exact.prevent="submitComposer"
        />

        <div class="flex items-center justify-between gap-2 pt-1">
          <Select
            :model-value="selectedModel"
            @update:model-value="updateSelectedModel"
          >
            <SelectTrigger
              :aria-label="t('composer.modelSelectAria')"
              class="h-9 max-w-[calc(100vw-148px)] min-w-0 overflow-hidden rounded-full border-agent-border bg-agent-surface px-3 text-[14px] font-medium tracking-normal text-agent-ink-soft shadow-none hover:border-agent-border hover:bg-agent-surface-raised focus:ring-agent-focus/35 sm:h-10 sm:max-w-none sm:min-w-[210px]"
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

          <div class="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
            <span class="hidden text-xs font-bold text-agent-ink-muted sm:inline">
              {{ messageCharacterCount }} / 2000
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              :title="t('composer.reset')"
              :aria-label="t('composer.reset')"
              class="size-9 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken hover:text-agent-ink disabled:text-agent-ink-faint sm:size-10"
              :disabled="!canReset || status === 'loading'"
              @click="emit('reset')"
            >
              <AppIcon name="tabler:rotate-clockwise" :size="18" />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              :title="t('composer.send')"
              :aria-label="t('composer.send')"
              class="size-10 rounded-full bg-agent-primary text-white shadow-none hover:bg-agent-primary-hover disabled:bg-agent-border sm:size-11"
              :disabled="status === 'loading'"
              @click="submitComposer"
            >
              <AppIcon v-if="status === 'loading'" name="tabler:loader-2" :size="19" class="animate-spin" />
              <AppIcon v-else name="tabler:arrow-up" :size="20" />
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
