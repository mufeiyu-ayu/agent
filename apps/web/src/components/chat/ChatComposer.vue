<script setup lang="ts">
import type { ReasoningEffort } from '@agent/contracts'
import type { GenerationStatus } from '../../types/chat'
import type { LlmModelOption } from '../../types/llm'

import { CHAT_MESSAGE_MAX_CHARS } from '@agent/contracts'
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
import AppTooltip from '@/components/common/AppTooltip.vue'
import { Button } from '@/components/ui/button'
import { dropdownMenuOptionClass, dropdownMenuPanelClass } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'

const props = defineProps<{
  message: string
  hasConversation: boolean
  models: LlmModelOption[]
  selectedModel: string | null
  selectedReasoningEffort: ReasoningEffort | null
  /** 模型列表读取失败时的提示，显示在选择器旁。 */
  modelError: string
  /** 原选中模型失效被自动替换后的提示。 */
  modelNotice: string
  status: GenerationStatus
  messageCharacterCount: number
  hero?: boolean
}>()

const emit = defineEmits<{
  'update:message': [value: string]
  'update:selectedModel': [value: string]
  'update:selectedReasoningEffort': [value: ReasoningEffort | null]
  'refreshModels': []
  'send': []
  'reset': []
  'stop': []
}>()

const { t } = useI18n()

const canReset = computed(() => {
  return props.hasConversation || props.message.trim().length > 0
})

const showCharacterCount = computed(() => {
  return props.messageCharacterCount >= CHAT_MESSAGE_MAX_CHARS * 0.9
})

const selectedModelOption = computed(() => {
  return props.models.find(model => model.id === props.selectedModel)
})

const selectedModelLabel = computed(() => {
  return selectedModelOption.value?.displayName ?? t('composer.modelPlaceholder')
})

/** 该家族可选的强度；为空的模型不显示、请求也不带。null 项表示用模型行默认。 */
const effortOptions = computed(() => selectedModelOption.value?.reasoningEffortOptions ?? [])
const showReasoningEffort = computed(() => effortOptions.value.length > 0)
/** 没有显式选择时不发送强度，展示模型行当前的默认值。 */
const effectiveReasoningEffort = computed(() => props.selectedReasoningEffort ?? selectedModelOption.value?.reasoningEffort ?? null)

/** null 项标出模型行当前的默认值，与触发器上显示的实际强度对得上。 */
function effortLabel(effort: ReasoningEffort | null): string {
  if (effort)
    return t(`composer.reasoningEffort.${effort}`)

  const modelDefault = selectedModelOption.value?.reasoningEffort
  return modelDefault
    ? t('composer.reasoningEffortDefaultWith', { effort: t(`composer.reasoningEffort.${modelDefault}`) })
    : t('composer.reasoningEffortDefault')
}

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

function selectModel(id: string) {
  emit('update:selectedModel', id)
}

/** 管理台可能刚隐藏 / 删除了模型或改了默认强度：每次打开下拉都重新拉取。 */
function handleModelMenuOpen(open: boolean) {
  if (open)
    emit('refreshModels')
}

function selectReasoningEffort(effort: ReasoningEffort | null) {
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
          :maxlength="CHAT_MESSAGE_MAX_CHARS"
          rows="1"
          class="max-h-40 resize-none border-0 bg-transparent px-3 pb-1 pt-2.5 text-base font-normal leading-6 text-agent-ink shadow-none focus-visible:ring-0 placeholder:text-agent-ink-muted"
          :class="hero ? 'min-h-16' : 'min-h-12'"
          :placeholder="hasConversation ? '' : t('composer.placeholder')"
          @update:model-value="updateMessage"
          @keydown.enter.exact="handleEnterKeydown"
        />

        <div class="flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5 pt-1">
          <div class="flex min-w-0 flex-wrap items-center gap-x-1">
            <DropdownMenuRoot @update:open="handleModelMenuOpen">
              <DropdownMenuTrigger
                type="button"
                :aria-label="t('composer.modelSelectAria')"
                class="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-agent-ink-soft transition hover:bg-agent-surface-sunken/55 hover:text-agent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/40 data-[state=open]:bg-agent-surface-sunken/55 data-[state=open]:text-agent-ink"
              >
                <span class="truncate">{{ selectedModelLabel }}</span>
                <span v-if="showReasoningEffort" class="shrink-0 text-agent-ink-muted">{{ effortLabel(effectiveReasoningEffort) }}</span>
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
                      <span class="block truncate text-sm text-agent-ink">{{ model.displayName }}</span>
                    </span>
                    <AppIcon
                      v-if="model.id === selectedModel"
                      name="tabler:check"
                      :size="16"
                      class="shrink-0 text-agent-accent"
                    />
                  </DropdownMenuItem>

                  <DropdownMenuSeparator v-if="showReasoningEffort" class="mx-1 my-1.5 h-px bg-agent-border-subtle" />

                  <DropdownMenuSub v-if="showReasoningEffort">
                    <DropdownMenuSubTrigger
                      class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm text-agent-ink outline-none transition data-[highlighted]:bg-agent-surface-sunken/50 data-[state=open]:bg-agent-surface-sunken/50"
                    >
                      <span>{{ t('composer.reasoningEffortLabel') }}</span>
                      <span class="flex shrink-0 items-center gap-1 text-agent-ink-muted">
                        {{ effortLabel(effectiveReasoningEffort) }}
                        <AppIcon name="tabler:chevron-right" :size="14" />
                      </span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuPortal>
                      <DropdownMenuSubContent
                        :side-offset="6"
                        class="min-w-[132px]" :class="[dropdownMenuPanelClass]"
                      >
                        <DropdownMenuItem
                          v-for="effort in [null, ...effortOptions]"
                          :key="effort ?? 'default'"
                          class="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm outline-none transition"
                          :class="dropdownMenuOptionClass(effort === selectedReasoningEffort)"
                          @select="selectReasoningEffort(effort)"
                        >
                          <span>{{ effortLabel(effort) }}</span>
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

            <p
              v-if="modelError || modelNotice"
              role="status"
              class="min-w-0 px-2 text-xs leading-5"
              :class="modelError ? 'text-agent-copper' : 'text-agent-ink-muted'"
            >
              {{ modelError || modelNotice }}
            </p>
          </div>

          <div class="flex shrink-0 items-center justify-end gap-1">
            <span
              v-if="showCharacterCount"
              class="text-xs font-medium text-agent-ink-muted"
            >
              {{ messageCharacterCount }} / {{ CHAT_MESSAGE_MAX_CHARS }}
            </span>
            <AppTooltip :content="t('composer.reset')">
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                :aria-label="t('composer.reset')"
                class="size-9 rounded-lg bg-transparent text-agent-ink-muted shadow-none hover:bg-agent-surface-sunken/55 hover:text-agent-ink disabled:text-agent-ink-faint"
                :disabled="!canReset || isGenerationInProgress"
                @click="emit('reset')"
              >
                <AppIcon name="tabler:rotate-clockwise" :size="17" />
              </Button>
            </AppTooltip>
            <AppTooltip :content="isGenerationInProgress ? t('composer.stop') : t('composer.send')">
              <Button
                type="button"
                size="icon-lg"
                :aria-label="isGenerationInProgress ? t('composer.stop') : t('composer.send')"
                class="size-9 rounded-xl text-white shadow-none disabled:bg-agent-border"
                :class="isGenerationInProgress ? 'bg-agent-copper hover:bg-agent-copper' : 'bg-agent-accent hover:bg-agent-accent/90'"
                :disabled="!isGenerationInProgress && !message.trim()"
                @click="triggerPrimaryAction"
              >
                <AppIcon v-if="isGenerationInProgress" name="tabler:player-stop" :size="18" />
                <AppIcon v-else name="tabler:arrow-up" :size="19" />
              </Button>
            </AppTooltip>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
