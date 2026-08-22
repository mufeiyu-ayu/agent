<script setup lang="ts">
import type { SeoConversationTurn } from '../../types/seo'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { useAgentConversationScroll } from '@/hooks/useAgentConversationScroll'
import { useConversationScrollMemory } from '@/hooks/useConversationScrollMemory'

import AgentAssistantReply from './AgentAssistantReply.vue'
import AgentMessage from './AgentMessage.vue'

const props = defineProps<{
  turns: SeoConversationTurn[]
  lastGeneratedAt: string
  isLoadingMessages: boolean
  conversationId: string | null
  anchorLatestTurn: boolean
}>()

const { t } = useI18n()
const conversationViewportRef = ref<HTMLElement | null>(null)

const activeTurnId = computed(() => {
  if (!props.anchorLatestTurn)
    return undefined

  return props.turns[props.turns.length - 1]?.id
})

const activeTurnSignature = computed(() => {
  if (!props.anchorLatestTurn)
    return ''

  const activeTurn = props.turns[props.turns.length - 1]

  if (!activeTurn)
    return ''

  return [
    activeTurn.id,
    activeTurn.status,
    activeTurn.generatedAt ?? '',
    activeTurn.reply?.length ?? 0,
    activeTurn.errorMessage?.length ?? 0,
  ].join(':')
})

useAgentConversationScroll({
  viewportRef: conversationViewportRef,
  activeTurnId,
  activeTurnSignature,
  enabled: computed(() => props.anchorLatestTurn),
})

const {
  isRestoringScroll,
} = useConversationScrollMemory({
  viewportRef: conversationViewportRef,
  conversationId: computed(() => props.conversationId),
  canRestore: computed(() => props.turns.length > 0 && !props.anchorLatestTurn),
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
      class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain"
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
                :class="anchorLatestTurn && turnIndex === turns.length - 1 ? 'min-h-[40dvh]' : undefined"
              >
                <div
                  v-if="(turn.status === 'thinking' || turn.status === 'generating') && !turn.reply"
                  class="inline-flex h-10 items-center justify-center text-agent-ink-muted"
                >
                  <AppIcon name="tabler:loader-2" :size="18" class="animate-spin" />
                </div>

                <template v-else-if="turn.status === 'error'">
                  <AgentAssistantReply
                    v-if="turn.reply && turn.reply !== turn.errorMessage"
                    :text="turn.reply"
                  />
                  <div
                    class="mt-2 inline-flex max-w-[620px] items-start gap-2.5 rounded-2xl border border-agent-copper/30 bg-agent-copper-soft px-4 py-3 text-sm font-semibold leading-6 text-agent-ink-soft"
                  >
                    <AppIcon name="tabler:alert-triangle" :size="18" class="mt-0.5 shrink-0 text-agent-copper" />
                    <span>{{ turn.errorMessage || t('conversation.fallbackError') }}</span>
                  </div>
                </template>

                <template v-else-if="turn.status === 'aborted'">
                  <AgentAssistantReply
                    v-if="turn.reply"
                    :text="turn.reply"
                  />
                  <div
                    class="mt-2 inline-flex max-w-[620px] items-center gap-2 rounded-xl border border-agent-border bg-agent-surface px-3 py-2 text-xs font-bold text-agent-ink-muted"
                  >
                    <AppIcon name="tabler:player-stop" :size="15" class="shrink-0" />
                    <span>{{ t('conversation.aborted') }}</span>
                  </div>
                </template>

                <AgentAssistantReply
                  v-else
                  :text="turn.reply || ''"
                  :is-streaming="turn.status === 'generating'"
                  :grounding="turn.grounding"
                />
              </AgentMessage>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
