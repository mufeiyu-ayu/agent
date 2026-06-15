<script setup lang="ts">
import AgentConversation from '../components/agent/AgentConversation.vue'
import AppMessage from '../components/common/AppMessage.vue'
import AppShell from '../components/layout/AppShell.vue'
import SeoChatComposer from '../components/seo/SeoChatComposer.vue'
import { useLlmRuntime } from '../hooks/useLlmRuntime'
import { useMockAgentPlatform } from '../hooks/useMockAgentPlatform'
import { useSeoWorkspace } from '../hooks/useSeoWorkspace'

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
</script>

<template>
  <AppShell
    :balance-available="balanceAvailable"
    :balance-label="balanceLabel"
    :balance-status="balanceStatus"
    :navigation-items="navigationItems"
    :recent-chats="recentChats"
    :user="user"
    @new-chat="resetWorkspace"
    @refresh-balance="refreshBalance"
  >
    <AppMessage
      :visible="appMessage.visible"
      :type="appMessage.type"
      :text="appMessage.text"
      @close="hideMessage"
    />

    <AgentConversation
      :last-generated-at="lastGeneratedAt"
      :turns="conversationTurns"
    />

    <SeoChatComposer
      v-model:message="message"
      v-model:selected-model="selectedModel"
      :models="models"
      :status="status"
      :message-character-count="messageCharacterCount"
      :validation-errors="validationErrors"
      @send="sendMessage(selectedModel)"
      @reset="resetWorkspace"
    />
  </AppShell>
</template>
