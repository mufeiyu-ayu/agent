<script setup lang="ts">
import type { ChatAttachment } from '../../types/chat'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useCopyFeedback } from '@/hooks/useCopyFeedback'
import { formatMessageTime } from '@/utils/time-format'

import AgentAttachmentPreview from './AgentAttachmentPreview.vue'
import AgentMessageAttachments from './AgentMessageAttachments.vue'

const props = defineProps<{
  text: string
  createdAt: string
  attachments?: ChatAttachment[]
}>()

const emit = defineEmits<{
  /** 文档类附件交给页面在右侧面板里预览；图片在这里自己全屏看。 */
  previewFile: [attachment: ChatAttachment]
}>()

const { locale, t } = useI18n()
const { copied, copy } = useCopyFeedback()
const copyLabel = computed(() => t(copied.value ? 'conversation.actions.copiedReply' : 'conversation.actions.copyReply'))
const time = computed(() => formatMessageTime(new Date(props.createdAt), locale.value))

// 全屏看图时左右切换的范围：这条消息里的所有图片。
const images = computed(() => (props.attachments ?? []).filter(item => item.kind === 'image'))
const imageIndex = ref<number | null>(null)

function openAttachment(attachment: ChatAttachment) {
  if (attachment.kind === 'image')
    imageIndex.value = images.value.indexOf(attachment)
  else
    emit('previewFile', attachment)
}

function copyMessage(event: MouseEvent) {
  if (event.detail > 0)
    (event.currentTarget as HTMLButtonElement | null)?.blur()
  void copy(props.text)
}
</script>

<template>
  <div class="group/user flex flex-col items-end">
    <AgentMessageAttachments
      v-if="attachments?.length"
      :attachments="attachments"
      :class="text ? 'mb-1.5' : undefined"
      @open="openAttachment"
    />
    <!-- 只发附件时没有文字气泡。 -->
    <div v-if="text" class="max-w-[660px] whitespace-pre-wrap rounded-2xl bg-agent-user-bubble px-4 py-2.5 text-base leading-7 text-agent-user-bubble-text min-[960px]:text-[15px] min-[960px]:leading-6">
      {{ text }}
    </div>

    <div class="mt-1 flex h-8 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 group-focus-within/user:opacity-100">
      <time v-if="time" :datetime="createdAt" class="px-1 text-xs text-agent-ink-faint">{{ time }}</time>
      <AppTooltip v-if="text" :content="copyLabel">
        <button
          type="button"
          :aria-label="copyLabel"
          class="grid size-7 place-items-center rounded-lg transition hover:bg-agent-surface-sunken focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
          :class="copied ? 'text-agent-moss' : 'text-agent-ink-muted hover:text-agent-ink'"
          @click="copyMessage"
        >
          <AppIcon :name="copied ? 'tabler:check' : 'tabler:copy'" :size="15" />
        </button>
      </AppTooltip>
    </div>

    <AgentAttachmentPreview
      v-if="imageIndex !== null"
      v-model:index="imageIndex"
      :items="images"
      @close="imageIndex = null"
    />
  </div>
</template>
