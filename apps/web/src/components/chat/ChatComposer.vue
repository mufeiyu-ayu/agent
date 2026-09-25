<script setup lang="ts">
import type { ReasoningEffort } from '@agent/contracts'
import type { GenerationStatus } from '../../types/chat'
import type { LlmModelOption } from '../../types/llm'

import { CHAT_MESSAGE_MAX_CHARS } from '@agent/contracts'
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatModelMenu from '@/components/chat/ChatModelMenu.vue'
import ChatTypewriterPlaceholder from '@/components/chat/ChatTypewriterPlaceholder.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAutosizeTextarea } from '@/hooks/useAutosizeTextarea'

const props = defineProps<{
  message: string
  models: LlmModelOption[]
  selectedModel: string | null
  selectedReasoningEffort: ReasoningEffort | null
  /** 模型列表读取失败时的提示。 */
  modelError: string
  /** 原选中模型失效被自动替换后的提示。 */
  modelNotice: string
  status: GenerationStatus
  messageCharacterCount: number
  /** 空态大输入框；否则是对话中底部的单行胶囊。 */
  hero?: boolean
}>()

const emit = defineEmits<{
  'update:message': [value: string]
  'update:selectedModel': [value: string]
  'update:selectedReasoningEffort': [value: ReasoningEffort | null]
  'refreshModels': []
  'send': []
  'stop': []
}>()

const { t } = useI18n()

const PLACEHOLDER_HINT_KEYS = ['ask', 'cite', 'search', 'summarize'] as const

/**
 * 输入法组合拼音期间 v-model 要到 compositionend 才更新，message 仍为空；
 * 此时也要隐藏打字机提示，否则会和正在组合的拼音叠在一起。
 */
const isComposing = ref(false)
/** 打字机提示只在空态 hero 输入框里、且还没输入内容时出现。 */
const showTypewriter = computed(() => Boolean(props.hero) && props.message.length === 0 && !isComposing.value)
const placeholderHints = computed(() => PLACEHOLDER_HINT_KEYS.map(key => t(`composer.placeholderHints.${key}`)))
/** 聚焦时输入框自带光标，隐藏假光标以免出现两个。 */
const isTextareaFocused = ref(false)

const inputContainer = ref<HTMLElement | null>(null)
const { isMultiline, resize: resizeTextarea } = useAutosizeTextarea(inputContainer, toRef(props, 'message'))

/**
 * 对话中的胶囊一旦超过一行就展开成上下两层（与空态同一排布），直到清空 / 发送才收回。
 * 单向切换：展开后输入区变宽，同一段文字可能又放得下一行，双向判断会在临界长度来回闪。
 */
const isExpanded = ref(false)
watch(isMultiline, (multiline) => {
  if (multiline)
    isExpanded.value = true
})
watch(() => props.message, (message) => {
  if (message.length === 0)
    isExpanded.value = false
})
const isStacked = computed(() => Boolean(props.hero) || isExpanded.value)
// 两套排布的内边距不同，切换后按新排布重算高度。
watch(isStacked, resizeTextarea, { flush: 'post' })

const showCharacterCount = computed(() => {
  return props.messageCharacterCount >= CHAT_MESSAGE_MAX_CHARS * 0.9
})

const isGenerationInProgress = computed(() => {
  return props.status === 'thinking' || props.status === 'generating'
})

/** 没有内容时不显示发送按钮；生成中始终显示停止按钮。 */
const showPrimaryAction = computed(() => isGenerationInProgress.value || props.message.trim().length > 0)
// 键盘焦点停在停止按钮上时生成结束，按钮卸载前把焦点交还输入框，不掉到 body。
watch(showPrimaryAction, async (show) => {
  if (show || !document.activeElement?.hasAttribute('data-composer-primary'))
    return
  await nextTick()
  inputContainer.value?.querySelector('textarea')?.focus()
}, { flush: 'pre' })

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
</script>

<template>
  <section
    :class="hero
      ? 'w-full'
      : 'relative z-10 shrink-0 px-3 pb-2 pt-2 sm:px-4 sm:pb-3'"
  >
    <div class="mx-auto w-full" :class="hero ? '' : 'max-w-[720px]'">
      <div
        class="composer-card border border-agent-border-soft bg-agent-surface-raised shadow-[0_1px_2px_rgb(61_49_36/4%),0_4px_8px_rgb(61_49_36/5%)] transition-colors focus-within:border-agent-border"
        :class="isStacked ? 'composer-card--stacked rounded-[20px] p-3' : 'composer-card--compact rounded-[20px] p-1.5'"
      >
        <div ref="inputContainer" class="composer-input relative min-w-0">
          <Textarea
            :model-value="message"
            :maxlength="CHAT_MESSAGE_MAX_CHARS"
            rows="1"
            class="resize-none border-0 bg-transparent text-base font-normal leading-6 text-agent-ink shadow-none field-sizing-fixed focus-visible:ring-0 placeholder:text-agent-ink-muted"
            :class="[
              hero ? 'min-h-16' : 'min-h-9',
              isStacked ? 'px-1.5 pb-1 pt-1.5' : 'px-2 py-1.5',
              showTypewriter && 'placeholder:text-transparent',
            ]"
            :placeholder="hero ? placeholderHints[0] : t('composer.replyPlaceholder')"
            @update:model-value="updateMessage"
            @keydown.enter.exact="handleEnterKeydown"
            @focus="isTextareaFocused = true"
            @blur="isTextareaFocused = false"
            @compositionstart="isComposing = true"
            @compositionend="isComposing = false"
          />

          <ChatTypewriterPlaceholder
            v-if="showTypewriter"
            :phrases="placeholderHints"
            :hide-caret="isTextareaFocused"
          />
        </div>

        <AppTooltip :content="t('composer.attachSoon')">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-disabled="true"
            :aria-label="t('composer.attachSoon')"
            class="composer-plus size-9 cursor-default rounded-lg bg-transparent text-agent-ink-soft shadow-none hover:bg-agent-surface-sunken/55 hover:text-agent-ink"
          >
            <AppIcon name="tabler:plus" :size="18" />
          </Button>
        </AppTooltip>

        <div v-if="isStacked" class="composer-meta flex min-w-0 items-center justify-end gap-1">
          <p
            v-if="modelError || modelNotice"
            role="status"
            class="min-w-0 px-1 text-xs leading-4"
            :class="modelError ? 'text-agent-copper' : 'text-agent-ink-muted'"
          >
            {{ modelError || modelNotice }}
          </p>
          <span v-if="showCharacterCount" class="shrink-0 px-1 text-xs font-medium text-agent-ink-muted">
            {{ messageCharacterCount }} / {{ CHAT_MESSAGE_MAX_CHARS }}
          </span>
          <ChatModelMenu
            :models="models"
            :selected-model="selectedModel"
            :selected-reasoning-effort="selectedReasoningEffort"
            @update:selected-model="emit('update:selectedModel', $event)"
            @update:selected-reasoning-effort="emit('update:selectedReasoningEffort', $event)"
            @refresh-models="emit('refreshModels')"
          />
        </div>

        <AppTooltip v-if="showPrimaryAction" :content="isGenerationInProgress ? t('composer.stop') : t('composer.send')">
          <Button
            type="button"
            size="icon-lg"
            :aria-label="isGenerationInProgress ? t('composer.stop') : t('composer.send')"
            data-composer-primary
            variant="ghost"
            class="composer-send size-9 rounded-lg bg-transparent shadow-none hover:bg-agent-surface-sunken/55"
            :class="isGenerationInProgress ? 'text-agent-copper hover:text-agent-copper' : 'text-agent-ink hover:text-agent-ink'"
            @click="triggerPrimaryAction"
          >
            <AppIcon v-if="isGenerationInProgress" name="tabler:player-stop" :size="18" />
            <AppIcon v-else name="tabler:arrow-up" :size="19" />
          </Button>
        </AppTooltip>
      </div>

      <div v-if="!hero" class="flex min-h-7 items-center justify-between gap-3 px-2 pt-1">
        <p
          v-if="!isStacked && (modelError || modelNotice)"
          role="status"
          class="min-w-0 text-xs leading-4"
          :class="modelError ? 'text-agent-copper' : 'text-agent-ink-muted'"
        >
          {{ modelError || modelNotice }}
        </p>
        <p v-else class="min-w-0 truncate text-xs leading-5 text-agent-ink-faint">
          {{ t('composer.disclaimer') }}
        </p>

        <div v-if="!isStacked" class="flex shrink-0 items-center gap-1">
          <span v-if="showCharacterCount" class="text-xs font-medium text-agent-ink-muted">
            {{ messageCharacterCount }} / {{ CHAT_MESSAGE_MAX_CHARS }}
          </span>
          <ChatModelMenu
            compact
            :models="models"
            :selected-model="selectedModel"
            :selected-reasoning-effort="selectedReasoningEffort"
            @update:selected-model="emit('update:selectedModel', $event)"
            @update:selected-reasoning-effort="emit('update:selectedReasoningEffort', $event)"
            @refresh-models="emit('refreshModels')"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/*
 * 同一组 DOM 用两套网格排布：
 * stacked（空态 / 对话中多行）：输入区占满第一行，第二行是「+ ｜ 模型 ｜ 发送」；
 * compact：一行「+ ｜ 输入 ｜ 发送」，多行时按钮贴底，始终在最后一行旁边。
 */
.composer-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
}

.composer-card--stacked {
  grid-template-areas:
    "input input input"
    "plus meta send";
  row-gap: 4px;
  align-items: center;
}

.composer-card--compact {
  grid-template-areas: "plus input send";
  column-gap: 2px;
  align-items: end;
}

.composer-input {
  grid-area: input;
}

.composer-plus {
  grid-area: plus;
}

.composer-meta {
  grid-area: meta;
}

.composer-send {
  grid-area: send;
}

.composer-card--stacked .composer-send {
  margin-left: 4px;
}
</style>
