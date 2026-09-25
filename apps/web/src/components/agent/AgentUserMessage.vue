<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useCopyFeedback } from '@/hooks/useCopyFeedback'
import { formatMessageTime } from '@/utils/time-format'

const props = defineProps<{
  text: string
  createdAt: string
}>()

const { locale, t } = useI18n()
const { copied, copy } = useCopyFeedback()
const copyLabel = computed(() => t(copied.value ? 'conversation.actions.copiedReply' : 'conversation.actions.copyReply'))
const time = computed(() => formatMessageTime(new Date(props.createdAt), locale.value))

function copyMessage(event: MouseEvent) {
  if (event.detail > 0)
    (event.currentTarget as HTMLButtonElement | null)?.blur()
  void copy(props.text)
}
</script>

<template>
  <div class="group/user flex flex-col items-end">
    <div class="max-w-[660px] whitespace-pre-wrap rounded-2xl bg-agent-user-bubble px-4 py-2.5 text-base leading-7 text-agent-user-bubble-text min-[960px]:text-[15px] min-[960px]:leading-6">
      {{ text }}
    </div>

    <div class="mt-1 flex h-8 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 group-focus-within/user:opacity-100">
      <time v-if="time" :datetime="createdAt" class="px-1 text-xs text-agent-ink-faint">{{ time }}</time>
      <AppTooltip :content="copyLabel">
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
  </div>
</template>
