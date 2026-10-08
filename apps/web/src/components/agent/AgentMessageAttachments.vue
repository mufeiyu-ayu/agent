<script setup lang="ts">
import type { ChatAttachment } from '../../types/chat'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { warmAttachmentPreview } from '@/utils/attachment-documents'
import { fitImageSize, formatFileSize, splitFileName } from '@/utils/attachments'
import { workspaceFileType } from '@/utils/workspace-files'

const props = defineProps<{
  attachments: ChatAttachment[]
}>()

const emit = defineEmits<{
  open: [attachment: ChatAttachment]
}>()

const { t } = useI18n()

const images = computed(() => props.attachments.filter(item => item.kind === 'image'))
const files = computed(() => props.attachments.filter(item => item.kind === 'file').map((file) => {
  const [base, extension] = splitFileName(file.name)
  return {
    file,
    base,
    extension,
    icon: workspaceFileType(file.name).icon,
    size: formatFileSize(file.bytes),
  }
}))

/** 没量到尺寸的图片按这个方形占位。 */
const UNKNOWN_IMAGE_SIDE = 240

/**
 * 单张图片按原比例显示并预留位置；宽度不够时等比缩小。
 * 多张统一成方格，尺寸写在 class 上。
 */
const singleImageStyle = computed(() => {
  const [image] = images.value
  if (!image || images.value.length > 1)
    return undefined

  const { width, height } = image.width && image.height
    ? fitImageSize(image.width, image.height)
    : { width: UNKNOWN_IMAGE_SIDE, height: UNKNOWN_IMAGE_SIDE }
  return { width: `${width}px`, aspectRatio: `${width} / ${height}` }
})
</script>

<template>
  <div class="flex max-w-full flex-col items-end gap-1.5">
    <!-- 一行最多三张；正好四张时排成 2×2，不让最后一张落单。 -->
    <div
      v-if="images.length > 0"
      class="flex flex-wrap justify-end gap-1.5"
      :class="images.length === 4 ? 'max-w-[246px]' : 'max-w-[372px]'"
    >
      <button
        v-for="image in images"
        :key="image.id"
        type="button"
        :aria-label="t('conversation.attachments.open', { name: image.name })"
        class="attachment-image max-w-full cursor-zoom-in overflow-hidden rounded-2xl border border-agent-border-subtle bg-agent-surface-sunken/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        :class="singleImageStyle ? undefined : 'size-[120px]'"
        :style="singleImageStyle"
        @click="emit('open', image)"
      >
        <img
          :src="image.thumbUrl ?? image.url"
          :alt="image.name"
          decoding="async"
          class="size-full object-cover transition-[filter] duration-150"
        >
      </button>
    </div>

    <!-- 文件像列表一样一行一个：点文件名那一段在右侧面板预览，末尾是下载。 -->
    <div v-if="files.length > 0" class="flex max-w-full flex-col items-end gap-1">
      <div
        v-for="item in files"
        :key="item.file.id"
        :title="item.file.name"
        class="inline-flex h-8 max-w-[min(100%,340px)] items-stretch rounded-lg border border-agent-border-soft bg-agent-surface-raised transition-colors hover:border-agent-border"
      >
        <button
          type="button"
          :aria-label="t('conversation.attachments.open', { name: item.file.name })"
          class="flex min-w-0 items-center gap-2 rounded-l-[7px] pl-2.5 pr-1 text-left transition-colors hover:bg-agent-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
          @pointerenter="warmAttachmentPreview(item.file.name)"
          @click="emit('open', item.file)"
        >
          <AppIcon :name="item.icon" :size="15" class="shrink-0" />
          <span class="flex min-w-0 text-[13px] font-medium leading-5 text-agent-ink">
            <span class="truncate">{{ item.base }}</span>
            <span class="shrink-0">{{ item.extension }}</span>
          </span>
          <span class="shrink-0 text-[11px] leading-5 tabular-nums text-agent-ink-muted">{{ item.size }}</span>
        </button>
        <a
          :href="item.file.url"
          :download="item.file.name"
          :aria-label="t('conversation.attachments.download', { name: item.file.name })"
          class="flex shrink-0 items-center rounded-r-[7px] pl-1 pr-2.5 text-agent-ink-faint transition-colors hover:bg-agent-surface hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
        >
          <AppIcon name="tabler:download" :size="13" />
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.attachment-image:hover img {
  filter: brightness(0.94);
}
</style>
