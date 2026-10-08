<script setup lang="ts">
import type { ComposerAttachment } from '../../types/chat'

import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'

import ChatAttachmentFileThumb from './ChatAttachmentFileThumb.vue'

defineProps<{
  attachments: ComposerAttachment[]
}>()

const emit = defineEmits<{
  remove: [id: string]
  retry: [id: string]
}>()

const { t } = useI18n()

/** 进度环周长：r = 9。 */
const RING_LENGTH = 2 * Math.PI * 9

function percent(progress: number) {
  return Math.round(progress * 100)
}

/**
 * 被移除的方块要脱离排布，后面的才能滑过来补位；
 * 脱离前把它钉在原来的位置上，否则绝对定位会让它跳到行首。
 */
function pinLeaving(element: Element) {
  const item = element as HTMLElement
  item.style.left = `${item.offsetLeft}px`
  item.style.top = `${item.offsetTop}px`
}
</script>

<template>
  <TransitionGroup
    tag="ul"
    name="composer-attachment"
    class="relative flex max-h-[152px] flex-wrap gap-2 overflow-y-auto px-1.5 pb-1.5 pt-1.5"
    :aria-label="t('composer.attachments.label')"
    @before-leave="pinLeaving"
  >
    <!-- 图片和文件都是同样大小的方块：图片是缩略图，文件是带扩展名角标的小纸片，文件名悬停可见。 -->
    <li
      v-for="item in attachments"
      :key="item.id"
      class="group/attachment relative size-16 shrink-0"
    >
      <AppTooltip :content="item.name">
        <img
          v-if="item.kind === 'image'"
          :src="item.url"
          :alt="item.name"
          class="size-full rounded-xl border border-agent-border-soft object-cover"
        >
        <ChatAttachmentFileThumb v-else :name="item.name" />
      </AppTooltip>

      <span
        v-if="item.status === 'uploading'"
        role="progressbar"
        :aria-label="t('composer.attachments.uploading', { percent: percent(item.progress) })"
        :aria-valuenow="percent(item.progress)"
        class="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/35"
      >
        <svg viewBox="0 0 24 24" class="size-6 -rotate-90" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="rgb(255 255 255 / 35%)" stroke-width="2.5" />
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="white"
            stroke-width="2.5"
            stroke-linecap="round"
            class="attachment-ring"
            :stroke-dasharray="RING_LENGTH"
            :stroke-dashoffset="RING_LENGTH * (1 - item.progress)"
          />
        </svg>
      </span>
      <AppTooltip v-else-if="item.status === 'error'" :content="t('composer.attachments.retry', { name: item.name })">
        <button
          type="button"
          :aria-label="t('composer.attachments.retry', { name: item.name })"
          class="absolute inset-0 grid place-items-center rounded-xl bg-black/50 text-white focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/60"
          @click="emit('retry', item.id)"
        >
          <AppIcon name="tabler:refresh" :size="18" />
        </button>
      </AppTooltip>

      <button
        type="button"
        :aria-label="t('composer.attachments.remove', { name: item.name })"
        :disabled="item.locked"
        class="attachment-remove absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-150 hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/60 group-hover/attachment:opacity-100"
        @click="emit('remove', item.id)"
      >
        <AppIcon name="tabler:x" :size="12" />
      </button>
    </li>
  </TransitionGroup>
</template>

<style scoped>
/* 新加的淡入放大，移除的原地缩小淡出，其余的滑过去补位。 */
.composer-attachment-enter-active {
  transition: opacity 0.2s ease-out, transform 0.2s cubic-bezier(0.22, 0.8, 0.24, 1);
}

.composer-attachment-leave-active {
  position: absolute;
  transition: opacity 0.16s ease-in, transform 0.16s ease-in;
}

.composer-attachment-enter-from,
.composer-attachment-leave-to {
  opacity: 0;
  transform: scale(0.82);
}

.composer-attachment-move {
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.attachment-ring {
  transition: stroke-dashoffset 0.12s linear;
}

/* 触屏没有悬停：移除按钮一直显示。 */
@media (hover: none) {
  .attachment-remove {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .composer-attachment-enter-active,
  .composer-attachment-leave-active,
  .composer-attachment-move {
    transition: none;
  }

  .attachment-ring {
    transition: none;
  }
}
</style>
