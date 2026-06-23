<script setup lang="ts">
import type { AgentRecentChat } from '../../types/agent-platform'

import AppIcon from '@/components/common/AppIcon.vue'

import ConversationListItem from './ConversationListItem.vue'

const props = defineProps<{
  hasMore: boolean
  isLoadingMore: boolean
  recentChats: AgentRecentChat[]
}>()

const emit = defineEmits<{
  deleteChat: [chatId: string]
  loadMore: []
  renameChat: [chatId: string, title: string]
  selectChat: [chatId: string]
}>()

function handleScroll(event: Event) {
  if (!props.hasMore || props.isLoadingMore)
    return

  const element = event.currentTarget

  if (!(element instanceof HTMLElement))
    return

  const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight

  if (distanceToBottom <= 56) {
    emit('loadMore')
  }
}
</script>

<template>
  <div
    class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
    @scroll="handleScroll"
  >
    <ConversationListItem
      v-for="chat in recentChats"
      :key="chat.id"
      :chat="chat"
      @delete-chat="emit('deleteChat', $event)"
      @rename-chat="(chatId, title) => emit('renameChat', chatId, title)"
      @select-chat="emit('selectChat', $event)"
    />

    <div
      v-if="isLoadingMore"
      class="flex h-10 items-center justify-center text-agent-ink-muted"
      aria-live="polite"
    >
      <AppIcon name="tabler:loader-2" :size="17" class="animate-spin" />
    </div>
  </div>
</template>
