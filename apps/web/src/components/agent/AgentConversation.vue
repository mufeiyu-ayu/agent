<script setup lang="ts">
import type { ConversationTurn } from '../../types/chat'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useAgentConversationScroll } from '@/hooks/useAgentConversationScroll'
import { useConversationScrollMemory } from '@/hooks/useConversationScrollMemory'
import { useWorkspaceTheme } from '@/hooks/useWorkspaceTheme'

import AgentAssistantReply from './AgentAssistantReply.vue'
import AgentMessage from './AgentMessage.vue'

const props = defineProps<{
  turns: ConversationTurn[]
  lastGeneratedAt: string
  isLoadingMessages: boolean
  conversationId: string | null
  anchorLatestTurn: boolean
}>()

const { t } = useI18n()
const { workspaceTheme } = useWorkspaceTheme()

const isDark = computed(() => workspaceTheme.value === 'olive-ember')
const conversationViewportRef = ref<HTMLElement | null>(null)

const activeTurnId = computed(() => {
  if (!props.anchorLatestTurn)
    return undefined

  return props.turns[props.turns.length - 1]?.id
})

const { isRestoringScroll } = useConversationScrollMemory({
  viewportRef: conversationViewportRef,
  conversationId: computed(() => props.conversationId),
  canRestore: computed(() => props.turns.length > 0 && !props.anchorLatestTurn),
})

const { isNearBottom, scrollToBottom } = useAgentConversationScroll({
  viewportRef: conversationViewportRef,
  activeTurnId,
  anchorLatestTurn: computed(() => props.anchorLatestTurn),
  conversationId: computed(() => props.conversationId),
  isRestoringScroll,
})

const isGenerating = computed(() => {
  const latestTurn = props.turns[props.turns.length - 1]
  return latestTurn?.status === 'generating' || latestTurn?.status === 'thinking'
})

const showFloatingLoading = computed(() => {
  return isGenerating.value && !isNearBottom.value
})
</script>

<template>
  <section
    class="relative flex min-h-0 w-full flex-1 flex-col"
  >
    <div
      v-if="turns.length === 0"
      class="min-h-0 flex-1"
      :aria-busy="isLoadingMessages ? 'true' : undefined"
    />

    <div
      v-else
      ref="conversationViewportRef"
      data-agent-conversation-viewport
      class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain [overflow-anchor:none]"
      :class="isRestoringScroll ? 'invisible' : undefined"
    >
      <div class="mx-auto flex min-h-full w-full max-w-[840px] flex-col px-4 pb-10 pt-[72px] sm:px-5 sm:pb-12">
        <div
          v-if="lastGeneratedAt !== '--:--'"
          class="pb-3 text-right text-xs font-semibold text-agent-ink-muted"
        >
          {{ t('conversation.lastReply', { time: lastGeneratedAt }) }}
        </div>
        <div>
          <div class="space-y-6 sm:space-y-7">
            <template
              v-for="(turn, turnIndex) in turns"
              :key="turn.id"
            >
              <AgentMessage
                role="user"
                :data-agent-user-turn-id="turn.id"
              >
                <div class="max-w-[660px] whitespace-pre-wrap rounded-2xl bg-agent-user-bubble px-4 py-3 text-base font-normal leading-7 text-agent-user-bubble-text ring-1 ring-agent-user-bubble-border min-[960px]:text-[15px] min-[960px]:leading-6">
                  {{ turn.userMessage }}
                </div>
              </AgentMessage>

              <AgentMessage
                role="agent"
                :class="anchorLatestTurn && turnIndex === turns.length - 1 ? 'min-h-[75dvh]' : undefined"
              >
                <div
                  v-if="(turn.status === 'thinking' || turn.status === 'generating') && !turn.reply"
                  class="inline-flex h-10 items-center justify-center text-agent-ink-muted"
                >
                  <AppIcon name="tabler:loader-2" :size="18" class="animate-spin" />
                </div>

                <AgentAssistantReply
                  v-if="turn.reply && (turn.status !== 'error' || turn.reply !== turn.errorMessage)"
                  :text="turn.reply"
                  :is-streaming="turn.status === 'generating'"
                  :grounding="turn.status === 'success' ? turn.grounding : undefined"
                />
                <div
                  v-if="turn.status === 'error'"
                  class="mt-2 inline-flex max-w-[620px] items-start gap-2.5 rounded-2xl border border-agent-copper/30 bg-agent-copper-soft px-4 py-3 text-sm font-semibold leading-6 text-agent-ink-soft"
                >
                  <AppIcon name="tabler:alert-triangle" :size="18" class="mt-0.5 shrink-0 text-agent-copper" />
                  <span>{{ turn.errorMessage || t('conversation.fallbackError') }}</span>
                </div>
                <div
                  v-else-if="turn.status === 'aborted'"
                  class="mt-2 inline-flex max-w-[620px] items-center gap-2 rounded-xl border border-agent-border bg-agent-surface px-3 py-2 text-xs font-bold text-agent-ink-muted"
                >
                  <AppIcon name="tabler:player-stop" :size="15" class="shrink-0" />
                  <span>{{ t('conversation.aborted') }}</span>
                </div>
              </AgentMessage>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- 悬浮 Loading 胶囊（GPT 同款三个跳动圆点，位于视口底部中央） -->
    <Transition name="floating-loading">
      <div
        v-if="showFloatingLoading"
        class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center"
      >
        <AppTooltip :content="t('conversation.actions.scrollToBottom')">
          <button
            type="button"
            :aria-label="t('conversation.actions.scrollToBottom')"
            class="pointer-events-auto flex h-8 w-12 items-center justify-center rounded-full border transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/40 motion-reduce:transition-none motion-reduce:hover:scale-100 motion-reduce:active:scale-100"
            :class="isDark
              ? 'border-white/10 bg-[#21252b] text-neutral-300 shadow-[0_4px_16px_rgba(0,0,0,0.35)]'
              : 'border-black/[0.08] bg-white text-neutral-600 shadow-[0_2px_12px_rgba(0,0,0,0.08)]'"
            @click="scrollToBottom('smooth')"
          >
            <div class="flex items-center gap-1">
              <span class="size-1 rounded-full bg-current dot-bounce dot-bounce-1" />
              <span class="size-1 rounded-full bg-current dot-bounce dot-bounce-2" />
              <span class="size-1 rounded-full bg-current dot-bounce dot-bounce-3" />
            </div>
          </button>
        </AppTooltip>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.floating-loading-enter-active,
.floating-loading-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.floating-loading-enter-from,
.floating-loading-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@keyframes gpt-dot-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.35;
  }
  40% {
    transform: translateY(-2.5px);
    opacity: 1;
  }
}

.dot-bounce {
  animation: gpt-dot-bounce 1.2s infinite ease-in-out;
}

.dot-bounce-1 {
  animation-delay: -0.32s;
}

.dot-bounce-2 {
  animation-delay: -0.16s;
}

.dot-bounce-3 {
  animation-delay: 0s;
}

@media (prefers-reduced-motion: reduce) {
  .dot-bounce { animation: none; }
  .floating-loading-enter-active,
  .floating-loading-leave-active { transition: none; }
}
</style>
