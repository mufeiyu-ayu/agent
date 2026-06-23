<script setup lang="ts">
import { computed } from 'vue'

import workspaceBgOliveEmberDeepUrl from '../assets/bg-olive.webp'
import workspaceBgAiBalancedUrl from '../assets/bg-warm.webp'
import AgentConversation from '../components/agent/AgentConversation.vue'
import AppMessage from '../components/common/AppMessage.vue'
import AppShell from '../components/layout/AppShell.vue'
import SeoChatComposer from '../components/seo/SeoChatComposer.vue'
import { useLlmRuntime } from '../hooks/useLlmRuntime'
import { useMockAgentPlatform } from '../hooks/useMockAgentPlatform'
import { useSeoWorkspace } from '../hooks/useSeoWorkspace'
import { useWorkspaceTheme } from '../hooks/useWorkspaceTheme'

const {
  workspaceTheme,
  workspaceThemeOptions,
  updateWorkspaceTheme,
} = useWorkspaceTheme()

const workspaceBackground = computed(() => ({
  imageUrl: workspaceTheme.value === 'olive-ember' ? workspaceBgOliveEmberDeepUrl : workspaceBgAiBalancedUrl,
  position: 'center center',
  opacity: workspaceTheme.value === 'olive-ember' ? '0.78' : '0.2',
}))

const {
  navigationItems,
  user,
} = useMockAgentPlatform()

const {
  models,
  selectedModel,
  balanceLabel,
  balanceAvailable,
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
  conversationTurns,
  messageCharacterCount,
  resetWorkspace,
  selectConversation,
  deleteConversationById,
  renameConversationById,
  loadMoreConversations,
  sendMessage,
  hideMessage,
} = useSeoWorkspace()

function applySuggestedPrompt(prompt: string) {
  message.value = prompt
}
</script>

<template>
  <AppShell
    :balance-available="balanceAvailable"
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

      <div class="relative z-10 flex min-h-0 flex-1 flex-col">
        <AgentConversation
          :last-generated-at="lastGeneratedAt"
          :turns="conversationTurns"
          @prompt-selected="applySuggestedPrompt"
        />

        <SeoChatComposer
          v-model:message="message"
          v-model:selected-model="selectedModel"
          :has-conversation="conversationTurns.length > 0"
          :models="models"
          :status="status"
          :message-character-count="messageCharacterCount"
          @send="sendMessage(selectedModel)"
          @reset="resetWorkspace"
        />
      </div>
    </div>
  </AppShell>
</template>
