<script setup lang="ts">
import type { ChatAttachment } from '../../types/chat'

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { splitFileName } from '@/utils/attachments'

const props = defineProps<{
  /** 同一条消息里的图片，左右切换在它们之间走。 */
  items: ChatAttachment[]
  index: number
}>()

const emit = defineEmits<{
  'update:index': [index: number]
  'close': []
}>()

const { t } = useI18n()

// 原生 dialog：进入 top layer、自带 Esc 关闭与焦点约束，关闭后焦点回到打开它的缩略图。
const dialog = ref<HTMLDialogElement | null>(null)
onMounted(() => dialog.value?.showModal())

const current = computed(() => props.items[props.index]!)
const nameParts = computed(() => splitFileName(current.value.name))

function step(offset: number) {
  const count = props.items.length
  if (count > 1)
    emit('update:index', (props.index + offset + count) % count)
}
</script>

<template>
  <dialog
    ref="dialog"
    class="attachment-preview"
    :aria-label="current.name"
    @close="emit('close')"
    @keydown.left="step(-1)"
    @keydown.right="step(1)"
  >
    <header class="flex h-14 shrink-0 items-center gap-3 pl-5 pr-3 text-white">
      <p class="flex min-w-0 flex-1 text-sm font-medium">
        <span class="truncate">{{ nameParts[0] }}</span>
        <span class="shrink-0">{{ nameParts[1] }}</span>
      </p>
      <span v-if="items.length > 1" class="shrink-0 text-xs tabular-nums text-white/65">
        {{ index + 1 }} / {{ items.length }}
      </span>
      <AppTooltip :content="t('conversation.attachments.download', { name: current.name })">
        <a
          :href="current.url"
          :download="current.name"
          :aria-label="t('conversation.attachments.download', { name: current.name })"
          class="preview-action"
        >
          <AppIcon name="tabler:download" :size="18" />
        </a>
      </AppTooltip>
      <AppTooltip :content="t('conversation.attachments.close')">
        <button
          type="button"
          autofocus
          :aria-label="t('conversation.attachments.close')"
          class="preview-action"
          @click="dialog?.close()"
        >
          <AppIcon name="tabler:x" :size="18" />
        </button>
      </AppTooltip>
    </header>

    <!-- 点图片以外的空白处关闭。 -->
    <div
      class="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center px-4 pb-5 sm:px-16"
      @click.self="dialog?.close()"
    >
      <img
        :key="current.id"
        :src="current.url"
        :alt="current.name"
        class="max-h-full max-w-full rounded-lg object-contain"
      >

      <template v-if="items.length > 1">
        <button
          type="button"
          :aria-label="t('conversation.attachments.previous')"
          class="preview-action preview-nav left-2 sm:left-3"
          @click="step(-1)"
        >
          <AppIcon name="tabler:chevron-left" :size="20" />
        </button>
        <button
          type="button"
          :aria-label="t('conversation.attachments.next')"
          class="preview-action preview-nav right-2 sm:right-3"
          @click="step(1)"
        >
          <AppIcon name="tabler:chevron-right" :size="20" />
        </button>
      </template>
    </div>
  </dialog>
</template>

<style scoped>
.attachment-preview {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: none;
  height: 100dvh;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  overflow: hidden;
}

.attachment-preview[open] {
  display: flex;
  flex-direction: column;
  animation: attachment-preview-in 0.16s ease-out both;
}

/* 暖色调的深底，不用纯黑。 */
.attachment-preview::backdrop {
  background: rgb(26 21 16 / 86%);
  backdrop-filter: blur(8px);
  animation: attachment-preview-in 0.16s ease-out both;
}

@keyframes attachment-preview-in {
  from {
    opacity: 0;
  }
}

.preview-action {
  display: grid;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 10px;
  color: rgb(255 255 255 / 82%);
  outline: none;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.preview-action:hover {
  background: rgb(255 255 255 / 12%);
  color: white;
}

.preview-action:focus-visible {
  box-shadow: 0 0 0 3px rgb(255 255 255 / 35%);
}

.preview-nav {
  position: absolute;
  top: 50%;
  width: 40px;
  height: 40px;
  border-radius: 9999px;
  background: rgb(255 255 255 / 10%);
  transform: translateY(-50%);
}

.preview-nav:hover {
  background: rgb(255 255 255 / 20%);
}

@media (prefers-reduced-motion: reduce) {
  .attachment-preview[open],
  .attachment-preview::backdrop {
    animation: none;
  }
}
</style>
