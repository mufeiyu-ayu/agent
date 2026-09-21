<script setup lang="ts">
import type { AgentNavigationItem, AgentPlatformUser } from '../types/agent-platform'

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import workspaceBgOliveEmberDeepUrl from '../assets/bg-olive.webp'
import workspaceBgAiBalancedUrl from '../assets/bg-warm.webp'
import AgentConversation from '../components/agent/AgentConversation.vue'
import ChatComposer from '../components/chat/ChatComposer.vue'
import AppIcon from '../components/common/AppIcon.vue'
import AppMessage from '../components/common/AppMessage.vue'
import AppShell from '../components/layout/AppShell.vue'
import { useChatWorkspace } from '../hooks/useChatWorkspace'
import { useLlmRuntime } from '../hooks/useLlmRuntime'
import { useWorkspaceTheme } from '../hooks/useWorkspaceTheme'

const navigationConfig = [
  { id: 'knowledge-qa', labelKey: 'navigation.knowledgeQa', icon: 'tabler:file-search', active: true },
  { id: 'article-search', labelKey: 'navigation.articleSearch', icon: 'tabler:bulb' },
  { id: 'cited-sources', labelKey: 'navigation.citedSources', icon: 'tabler:article' },
  { id: 'run-trace', labelKey: 'navigation.runTrace', icon: 'tabler:checklist' },
  { id: 'history', labelKey: 'navigation.history', icon: 'tabler:history' },
  { id: 'settings', labelKey: 'navigation.settings', icon: 'tabler:settings' },
] as const

const user: AgentPlatformUser = {
  name: 'Demo User',
  initials: 'D',
}

const { t } = useI18n()

const {
  workspaceTheme,
  workspaceThemeOptions,
  updateWorkspaceTheme,
} = useWorkspaceTheme()

const navigationItems = computed<AgentNavigationItem[]>(() => {
  return navigationConfig.map(item => ({
    id: item.id,
    label: t(item.labelKey),
    icon: item.icon,
    active: 'active' in item ? item.active : undefined,
  }))
})

const {
  models,
  selectedModel,
  selectedReasoningEffort,
  balanceLabel,
  balanceAvailable,
  balanceHidden,
  balanceStatus,
  refreshBalance,
} = useLlmRuntime()

const {
  message,
  status,
  lastGeneratedAt,
  appMessage,
  recentChats,
  hasMoreConversations,
  isLoadingMoreConversations,
  isLoadingMessages,
  shouldAnchorLatestTurn,
  activeConversationId,
  conversationTurns,
  messageCharacterCount,
  resetWorkspace,
  selectConversation,
  deleteConversationById,
  renameConversationById,
  loadMoreConversations,
  sendMessage,
  stopGeneration,
  hideMessage,
} = useChatWorkspace()

const showConversationEmptyState = computed(() => {
  return !activeConversationId.value && conversationTurns.value.length === 0 && !isLoadingMessages.value
})

const workspaceBackground = computed(() => {
  const isDark = workspaceTheme.value === 'olive-ember'
  const activeOpacity = isDark ? '0.78' : '0.2'

  return {
    imageUrl: isDark ? workspaceBgOliveEmberDeepUrl : workspaceBgAiBalancedUrl,
    position: 'center center',
    opacity: showConversationEmptyState.value ? activeOpacity : '0',
  }
})

const starterPrompts = computed(() => [
  { key: 'ask', label: t('conversation.starterPrompts.ask.label'), prompt: t('conversation.starterPrompts.ask.prompt') },
  { key: 'search', label: t('conversation.starterPrompts.search.label'), prompt: t('conversation.starterPrompts.search.prompt') },
  { key: 'capabilities', label: t('conversation.starterPrompts.capabilities.label'), prompt: t('conversation.starterPrompts.capabilities.prompt') },
])

function applySuggestedPrompt(prompt: string) {
  message.value = prompt
}

/** 没选强度就不带 reasoningEffort，后端用模型行默认。 */
function send() {
  void sendMessage(selectedModel.value, selectedReasoningEffort.value ?? undefined)
}
</script>

<template>
  <AppShell
    :balance-available="balanceAvailable"
    :balance-hidden="balanceHidden"
    :balance-label="balanceLabel"
    :balance-status="balanceStatus"
    :has-more-recent-chats="hasMoreConversations"
    :is-loading-more-recent-chats="isLoadingMoreConversations"
    :navigation-items="navigationItems"
    :recent-chats="recentChats"
    :user="user"
    :workspace-background="workspaceBackground"
    :workspace-theme="workspaceTheme"
    :workspace-theme-options="workspaceThemeOptions"
    @delete-chat="deleteConversationById"
    @load-more-chats="loadMoreConversations"
    @new-chat="resetWorkspace"
    @refresh-balance="refreshBalance"
    @rename-chat="renameConversationById"
    @select-chat="selectConversation"
    @update-workspace-theme="updateWorkspaceTheme"
  >
    <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <AppMessage
        :visible="appMessage.visible"
        :type="appMessage.type"
        :text="appMessage.text"
        @close="hideMessage"
      />

      <div
        v-if="showConversationEmptyState"
        class="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-6 pt-14 sm:px-6"
      >
        <div class="my-auto w-full max-w-[680px] pb-[8dvh]">
          <h2 class="workspace-greeting text-center text-[28px] leading-snug text-agent-ink sm:text-[34px]">
            <AppIcon name="tabler:asterisk" :size="26" class="mr-1.5 inline-block align-[-0.2em] text-agent-accent" />{{ t('conversation.emptyTitle') }}
          </h2>

          <ChatComposer
            v-model:message="message"
            v-model:selected-model="selectedModel"
            v-model:selected-reasoning-effort="selectedReasoningEffort"
            hero
            class="mt-8"
            :has-conversation="false"
            :models="models"
            :status="status"
            :message-character-count="messageCharacterCount"
            @send="send"
            @stop="stopGeneration"
            @reset="resetWorkspace"
          />

          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <button
              v-for="prompt in starterPrompts"
              :key="prompt.key"
              type="button"
              class="rounded-full border border-agent-border-soft bg-agent-surface-raised/70 px-3.5 py-1.5 text-[13px] font-medium text-agent-ink-soft transition hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
              @click="applySuggestedPrompt(prompt.prompt)"
            >
              {{ prompt.label }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="relative z-10 flex min-h-0 flex-1 flex-col">
        <AgentConversation
          :anchor-latest-turn="shouldAnchorLatestTurn"
          :conversation-id="activeConversationId"
          :is-loading-messages="isLoadingMessages"
          :last-generated-at="lastGeneratedAt"
          :turns="conversationTurns"
        />

        <ChatComposer
          v-model:message="message"
          v-model:selected-model="selectedModel"
          v-model:selected-reasoning-effort="selectedReasoningEffort"
          :has-conversation="conversationTurns.length > 0"
          :models="models"
          :status="status"
          :message-character-count="messageCharacterCount"
          @send="send"
          @stop="stopGeneration"
          @reset="resetWorkspace"
        />
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.workspace-greeting {
  font-family: "Libre Baskerville", Georgia, "Songti SC", "Noto Serif SC", ui-serif, serif;
  text-wrap: balance;
}
</style>
