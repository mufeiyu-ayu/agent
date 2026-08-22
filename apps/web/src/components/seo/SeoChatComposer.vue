<script setup lang="ts">
import type { DeepSeekReasoningEffort } from '@agent/contracts'
import type { LlmModelOption } from '../../types/llm'
import type { GenerationStatus } from '../../types/seo'

import {
  DEEPSEEK_REASONING_EFFORTS,
  SEO_CHAT_MESSAGE_MAX_CHARS,
} from '@agent/contracts'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'reka-ui'
import { computed } from 'vue'

import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { Button } from '@/components/ui/button'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  message: string
  hasConversation: boolean
  models: LlmModelOption[]
  selectedModel: LlmModelOption['id']
  selectedReasoningEffort: DeepSeekReasoningEffort
  status: GenerationStatus
  messageCharacterCount: number
  hero?: boolean
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

const showCharacterCount = computed(() => {
  return props.messageCharacterCount >= SEO_CHAT_MESSAGE_MAX_CHARS * 0.9
})

const selectedModelLabel = computed(() => {
  return props.models.find(model => model.id === props.selectedModel)?.label ?? t('composer.modelPlaceholder')
})

const isGenerationInProgress = computed(() => {
  return props.status === 'thinking' || props.status === 'generating'
})

function submitComposer() {
  if (isGenerationInProgress.value || !props.message.trim())
    return

  emit('send')
}

/**
 * 中文输入法组词期间按 Enter 是在确认候选词，不应发送消息。
 * Safari 会在 compositionend 之后才派发 keydown（isComposing 已为 false），
 * 只能靠遗留的 keyCode 229 识别。
 */
function handleEnterKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229)
    return

  event.preventDefault()
  submitComposer()
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

function selectModel(id: LlmModelOption['id']) {
  emit('update:selectedModel', id)
}

function selectReasoningEffort(effort: DeepSeekReasoningEffort) {
  emit('update:selectedReasoningEffort', effort)
}
</script>

<template>
  <section
    :class="hero
      ? 'w-full'
      : 'relative z-10 shrink-0 px-3 pb-3 pt-2 sm:px-4 sm:pb-4'"
  >
    <div class="mx-auto w-full" :class="hero ? '' : 'max-w-[720px]'">
      <div
        class="rounded-2xl border border-agent-border-soft bg-agent-surface-raised p-2 shadow-[0_1px_2px_rgb(61_49_36/4%),0_4px_8px_rgb(61_49_36/5%)] transition-colors focus-within:border-agent-border"
      >
        <Textarea
          :model-value="message"
          :maxlength="SEO_CHAT_MESSAGE_MAX_CHARS"
          rows="1"
          class="max-h-40 resize-none border-0 bg-transparent px-3 pb-1 pt-2.5 text-base font-normal leading-6 text-agent-ink shadow-none focus-visible:ring-0 placeholder:text-agent-ink-muted"
          :class="hero ? 'min-h-16' : 'min-h-12'"
          :placeholder="hasConversation ? '' : t('composer.placeholder')"
          @update:model-value="updateMessage"
          @keydown.enter.exact="handleEnterKeydown"
        />

        <div class="flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5 pt-1">
          <div class="flex min-w-0 items-center">
            <DropdownMenuRoot>
              <DropdownMenuTrigger
                type="button"
                :aria-label="t('composer.modelSelectAria')"
                class="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-agent-ink-soft transition hover:bg-agent-surface-sunken/55 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/40 data-[state=open]:bg-agent-surface-sunken/55 data-[state=open]:text-agent-ink"
              >
                <span class="truncate">{{ selectedModelLabel }}</span>
                <span class="shrink-0 text-agent-ink-muted">{{ t(`composer.reasoningEffort.${selectedReasoningEffort}`) }}</span>
                <AppIcon name="tabler:chevron-down" :size="14" class="shrink-0 text-agent-ink-muted" />
              </DropdownMenuTrigger>

              <DropdownMenuPortal>
                <DropdownMenuContent
                  align="start"
                  :side-offset="8"
                  class="w-[270px]" :class="[dropdownMenuPanelClass]"
                >
                  <DropdownMenuItem
                    v-for="model in models"
                    :key="model.id"
                    class="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 outline-none transition data-[highlighted]:bg-agent-surface-sunken/50"
                    @select="selectModel(model.id)"
                  >
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm text-agent-ink">{{ model.label }}</span>
                      <span class="mt-0.5 block truncate text-xs text-agent-ink-muted">{{ t(`composer.modelDescriptions.${model.id}`) }}</span>
                    </span>
                    <AppIcon
                      v-if="model.id === selectedModel"
                      name="tabler:check"
                      :size="16"
                      class="shrink-0 text-agent-accent"
                    />
                  </DropdownMenuItem>

                  <DropdownMenuSeparator class="mx-1 my-1.5 h-px bg-agent-border-subtle" />

                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-agent-ink outline-none transition data-[highlighted]:bg-agent-surface-sunken/50 data-[state=open]:bg-agent-surface-sunken/50"
                    >
                      <span>{{ t('composer.reasoningEffortLabel') }}</span>
                      <span class="flex shrink-0 items-center gap-1 text-agent-ink-muted">
                        {{ t(`composer.reasoningEffort.${selectedReasoningEffort}`) }}
                        <AppIcon name="tabler:chevron-right" :size="14" />
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent
                        :side-offset="6"
                        class="min-w-[132px]" :class="[dropdownMenuPanelClass]"
                      >
                        <DropdownMenuItem
                          v-for="effort in DEEPSEEK_REASONING_EFFORTS"
                          :key="effort"
                          class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm outline-none transition"
                          :class="dropdownMenuOptionClass(effort === selectedReasoningEffort)"
                          @select="selectReasoningEffort(effort)"
                        >
                          <span>{{ t(`composer.reasoningEffort.${effort}`) }}</span>
                          <AppIcon
                            v-if="effort === selectedReasoningEffort"
                            name="tabler:check"
                            :size="15"
                            class="shrink-0"
                          />
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuPortal>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </div>

          <div class="flex shrink-0 items-center justify-end gap-1">
            <span
              v-if="showCharacterCount"
              class="text-xs font-medium text-agent-ink-muted"
            >
              {{ messageCharacterCount }} / {{ SEO_CHAT_MESSAGE_MAX_CHARS }}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              :title="t('composer.reset')"
              :aria-label="t('composer.reset')"
              class="size-9 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken/55 hover:text-agent-ink disabled:text-agent-ink-faint"
              :disabled="!canReset || isGenerationInProgress"
              @click="emit('reset')"
            >
              <AppIcon name="tabler:rotate-clockwise" :size="17" />
            </Button>
            <Button
              type="button"
              size="icon-lg"
              :title="isGenerationInProgress ? t('composer.stop') : t('composer.send')"
              :aria-label="isGenerationInProgress ? t('composer.stop') : t('composer.send')"
              class="size-9 rounded-xl text-white shadow-none disabled:bg-agent-border"
              :class="isGenerationInProgress ? 'bg-agent-copper hover:bg-agent-copper' : 'bg-agent-accent hover:bg-agent-accent/90'"
              :disabled="!isGenerationInProgress && !message.trim()"
              @click="triggerPrimaryAction"
            >
              <AppIcon v-if="isGenerationInProgress" name="tabler:player-stop" :size="18" />
              <AppIcon v-else name="tabler:arrow-up" :size="19" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
