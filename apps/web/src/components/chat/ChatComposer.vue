<script setup lang="ts">
import type { ReasoningEffort } from '@agent/contracts'
import type { ComposerAttachment, GenerationStatus } from '../../types/chat'
import type { LlmModelOption } from '../../types/llm'

import { CHAT_MESSAGE_MAX_CHARS } from '@agent/contracts'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatAttachMenu from '@/components/chat/ChatAttachMenu.vue'
import ChatComposerAttachments from '@/components/chat/ChatComposerAttachments.vue'
import ChatModelMenu from '@/components/chat/ChatModelMenu.vue'
import ChatTypewriterPlaceholder from '@/components/chat/ChatTypewriterPlaceholder.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAutosizeTextarea } from '@/hooks/useAutosizeTextarea'
import { ATTACHMENT_ACCEPT } from '@/utils/attachments'

const props = defineProps<{
  message: string
  attachments: ComposerAttachment[]
  /** 当前选中的模型不能看图片、而附件里有图片：不让发送，提示换模型或移除图片。 */
  imagesUnsupported?: boolean
  models: LlmModelOption[]
  modelsLoading: boolean
  selectedModel: string | null
  selectedReasoningEffort: ReasoningEffort | null
  /** 模型列表读取失败时的提示。 */
  modelError: string
  /** 原选中模型失效被自动替换后的提示。 */
  modelNotice: string
  status: GenerationStatus
  messageCharacterCount: number
  historyReady?: boolean
  historyLoading?: boolean
  historyError?: string
  /** 空态大输入框；否则是对话中底部的单行胶囊。 */
  hero?: boolean
}>()

const emit = defineEmits<{
  'update:message': [value: string]
  'addFiles': [files: File[]]
  'removeAttachment': [id: string]
  'retryAttachment': [id: string]
  'update:selectedModel': [value: string]
  'update:selectedReasoningEffort': [value: ReasoningEffort | null]
  'refreshModels': []
  'send': []
  'stop': []
  'retryHistory': []
}>()

const { t } = useI18n()

const PLACEHOLDER_HINT_KEYS = ['ask', 'search'] as const

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
// 有附件时也用上下两层：附件排在输入文字上方。
const isStacked = computed(() => Boolean(props.hero) || isExpanded.value || props.attachments.length > 0)
// 两套排布的内边距不同，切换后按新排布重算高度。
watch(isStacked, resizeTextarea, { flush: 'post' })

const showCharacterCount = computed(() => {
  return props.messageCharacterCount >= CHAT_MESSAGE_MAX_CHARS * 0.9
})

const isGenerationInProgress = computed(() => {
  return props.status === 'thinking' || props.status === 'generating'
})

const hasContent = computed(() => props.message.trim().length > 0 || props.attachments.length > 0)
/** 附件没传完或有失败的：发送按钮照常显示，但点了不发。 */
const attachmentsPending = computed(() => props.attachments.some(item => item.status !== 'ready'))
const attachmentsBlockSend = computed(() => attachmentsPending.value || Boolean(props.imagesUnsupported))
const sendLabel = computed(() => {
  if (attachmentsPending.value)
    return t(props.attachments.some(item => item.status === 'error') ? 'composer.attachments.sendFailed' : 'composer.attachments.sendUploading')
  return t(props.imagesUnsupported ? 'composer.attachments.sendImagesUnsupported' : 'composer.send')
})

/** 没有内容时不显示发送按钮；生成中始终显示停止按钮。 */
const showPrimaryAction = computed(() => isGenerationInProgress.value || hasContent.value)
// 键盘焦点停在停止按钮上时生成结束，按钮卸载前把焦点交还输入框，不掉到 body。
watch(showPrimaryAction, async (show) => {
  if (show || !document.activeElement?.hasAttribute('data-composer-primary'))
    return
  await nextTick()
  focus()
}, { flush: 'pre' })

function focus() {
  inputContainer.value?.querySelector('textarea')?.focus()
}

defineExpose({ focus })

function submitComposer() {
  if (props.historyReady === false || isGenerationInProgress.value || !hasContent.value || attachmentsBlockSend.value)
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

const fileInput = ref<HTMLInputElement | null>(null)

function addFiles(files: FileList | null | undefined) {
  if (files?.length)
    emit('addFiles', [...files])
}

function handleFilesPicked() {
  addFiles(fileInput.value?.files)
  // 清空后同一个文件才能再选一次。
  if (fileInput.value)
    fileInput.value.value = ''
}

/**
 * 剪贴板里有文件（截图、复制的文件）就当附件收下；纯文字照常粘贴。
 * Excel / Word 里复制的内容会同时带一张渲染图：既有富文本又有纯文本时按文字粘贴。
 */
function handlePaste(event: ClipboardEvent) {
  const data = event.clipboardData
  if (!data?.files.length || (data.types.includes('text/html') && data.types.includes('text/plain')))
    return

  event.preventDefault()
  addFiles(data.files)
}

/**
 * 拖放接在整个窗口上：拖偏一点松手也收得到，同时拦住浏览器「打开这个文件」的默认行为。
 * dragenter / dragleave 会在每个子元素上成对触发，用计数判断是否真的离开了窗口。
 */
const isDraggingFiles = ref(false)
let dragDepth = 0

function carriesFiles(event: DragEvent) {
  return event.dataTransfer?.types.includes('Files') ?? false
}

useEventListener(window, 'dragenter', (event) => {
  if (!carriesFiles(event))
    return
  dragDepth++
  isDraggingFiles.value = true
})
useEventListener(window, 'dragleave', (event) => {
  if (!carriesFiles(event))
    return
  dragDepth = Math.max(0, dragDepth - 1)
  isDraggingFiles.value = dragDepth > 0
})
useEventListener(window, 'dragover', (event) => {
  if (carriesFiles(event))
    event.preventDefault()
})
useEventListener(window, 'drop', (event) => {
  if (!carriesFiles(event))
    return
  event.preventDefault()
  dragDepth = 0
  isDraggingFiles.value = false
  addFiles(event.dataTransfer?.files)
})
</script>

<template>
  <section
    :class="hero
      ? 'w-full'
      : 'relative z-10 shrink-0 px-3 pb-2 pt-2 sm:px-4 sm:pb-3'"
  >
    <div class="mx-auto w-full" :class="hero ? '' : 'max-w-[720px]'">
      <p v-if="historyReady === false" role="status" class="px-2 pb-2 text-xs text-agent-ink-muted">
        {{ historyLoading ? t('composer.historyLoading') : historyError }}
        <button v-if="!historyLoading" class="ml-2 underline" @click="emit('retryHistory')">
          {{ t('composer.retryHistory') }}
        </button>
      </p>
      <div
        class="composer-card relative border bg-agent-surface-raised shadow-[0_1px_2px_rgb(61_49_36/4%),0_4px_8px_rgb(61_49_36/5%)] transition-colors"
        :class="[
          isStacked ? 'composer-card--stacked rounded-[20px] p-3' : 'composer-card--compact rounded-[20px] p-1.5',
          isDraggingFiles ? 'border-agent-accent' : 'border-agent-border-soft focus-within:border-agent-border',
        ]"
      >
        <div class="composer-body min-w-0">
          <ChatComposerAttachments
            v-if="attachments.length > 0"
            :attachments="attachments"
            @remove="emit('removeAttachment', $event)"
            @retry="emit('retryAttachment', $event)"
          />
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
              @paste="handlePaste"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
            />

            <ChatTypewriterPlaceholder
              v-if="showTypewriter"
              :phrases="placeholderHints"
              :hide-caret="isTextareaFocused"
            />
          </div>
        </div>

        <input
          ref="fileInput"
          type="file"
          multiple
          hidden
          tabindex="-1"
          :accept="ATTACHMENT_ACCEPT"
          @change="handleFilesPicked"
        >
        <div class="composer-plus flex">
          <ChatAttachMenu :side="hero ? 'bottom' : 'top'" @pick-files="fileInput?.click()" />
        </div>

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
            :models-loading="modelsLoading"
            :selected-model="selectedModel"
            :selected-reasoning-effort="selectedReasoningEffort"
            @update:selected-model="emit('update:selectedModel', $event)"
            @update:selected-reasoning-effort="emit('update:selectedReasoningEffort', $event)"
            @refresh-models="emit('refreshModels')"
          />
        </div>

        <AppTooltip v-if="showPrimaryAction" :content="isGenerationInProgress ? t('composer.stop') : sendLabel">
          <Button
            type="button"
            size="icon-lg"
            :aria-label="isGenerationInProgress ? t('composer.stop') : sendLabel"
            data-composer-primary
            :disabled="historyReady === false && !isGenerationInProgress"
            :aria-disabled="(!isGenerationInProgress && attachmentsBlockSend) || undefined"
            :aria-busy="historyLoading || undefined"
            variant="ghost"
            class="composer-send size-9 rounded-lg bg-transparent shadow-none hover:bg-agent-surface-sunken/55 aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
            :class="isGenerationInProgress ? 'text-agent-copper hover:text-agent-copper' : 'text-agent-ink hover:text-agent-ink'"
            @click="triggerPrimaryAction"
          >
            <AppIcon v-if="isGenerationInProgress" name="tabler:player-stop" :size="18" />
            <AppIcon v-else name="tabler:arrow-up" :size="19" />
          </Button>
        </AppTooltip>

        <!-- 盖在卡片上、不占位：拖入时输入框本身不动。 -->
        <div
          v-if="isDraggingFiles"
          class="pointer-events-none absolute inset-0 grid place-items-center rounded-[19px] bg-agent-surface-raised/92 text-sm font-medium text-agent-accent"
        >
          <span class="inline-flex items-center gap-2">
            <AppIcon name="tabler:cloud-upload" :size="18" />
            {{ t('composer.attachments.dropHint') }}
          </span>
        </div>
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
            :models-loading="modelsLoading"
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

.composer-body {
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
