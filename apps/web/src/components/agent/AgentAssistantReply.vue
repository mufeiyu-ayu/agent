<script setup lang="ts">
import type { MessageGroundingV1 } from '@agent/contracts'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useCopyFeedback } from '@/hooks/useCopyFeedback'

import AgentGroundingPanel from './AgentGroundingPanel.vue'
import AgentMarkdownContent from './AgentMarkdownContent.vue'

const props = defineProps<{
  text: string
  isStreaming?: boolean
  /** 只有已完成回答才会拿到 Grounding；streaming、error 与 aborted 分支不传。 */
  grounding?: MessageGroundingV1 | null
}>()

const { t } = useI18n()
const { copied, copy } = useCopyFeedback()
const copyLabel = computed(() => t(copied.value ? 'conversation.actions.copiedReply' : 'conversation.actions.copyReply'))

function copyReply(event: MouseEvent) {
  if (event.detail > 0)
    (event.currentTarget as HTMLButtonElement | null)?.blur()
  void copy(props.text.trim())
}
</script>

<template>
  <div class="group/reply min-w-0 max-w-[700px] pt-1">
    <AgentMarkdownContent
      :text="text"
      :is-streaming="isStreaming"
    />

    <AgentGroundingPanel
      v-if="!isStreaming && grounding"
      :grounding="grounding"
    />

    <div class="mt-2 flex h-8 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/reply:opacity-100 group-focus-within/reply:opacity-100">
      <AppTooltip :content="copyLabel">
        <button
          type="button"
          :aria-label="copyLabel"
          class="grid size-7 place-items-center rounded-lg transition hover:bg-agent-surface-sunken focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40 disabled:pointer-events-none disabled:opacity-45"
          :class="copied ? 'text-agent-moss' : 'text-agent-ink-muted hover:text-agent-ink'"
          :disabled="!props.text.trim()"
          @click="copyReply"
        >
          <AppIcon :name="copied ? 'tabler:check' : 'tabler:copy'" :size="15" />
        </button>
      </AppTooltip>
    </div>
  </div>
</template>
