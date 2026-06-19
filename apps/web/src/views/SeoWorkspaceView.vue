<script setup lang="ts">
import workspaceBgAiBalancedUrl from '../assets/workspace-backgrounds/workspace-bg-ai-balanced.png'
import AgentConversation from '../components/agent/AgentConversation.vue'
import AppMessage from '../components/common/AppMessage.vue'
import AppShell from '../components/layout/AppShell.vue'
import SeoChatComposer from '../components/seo/SeoChatComposer.vue'
import { useLlmRuntime } from '../hooks/useLlmRuntime'
import { useMockAgentPlatform } from '../hooks/useMockAgentPlatform'
import { useSeoWorkspace } from '../hooks/useSeoWorkspace'

const workspaceBackground = {
  imageUrl: workspaceBgAiBalancedUrl,
  position: 'center center',
  opacity: '0.2',
} as const

const {
  navigationItems,
  recentChats,
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
  validationErrors,
  appMessage,
  conversationTurns,
  messageCharacterCount,
  resetWorkspace,
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
    :navigation-items="navigationItems"
    :recent-chats="recentChats"
    :user="user"
    :workspace-background="workspaceBackground"
    @new-chat="resetWorkspace"
    @refresh-balance="refreshBalance"
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
          :validation-errors="validationErrors"
          @send="sendMessage(selectedModel)"
          @reset="resetWorkspace"
        />
      </div>
    </div>
  </AppShell>
</template>
