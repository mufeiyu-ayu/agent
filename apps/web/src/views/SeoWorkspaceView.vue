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
  instruction,
  pageTopic,
  language,
  keywordInput,
  keywords,
  status,
  lastGeneratedAt,
  copiedItemKey,
  validationErrors,
  appMessage,
  conversationTurns,
  instructionCharacterCount,
  addKeyword,
  removeKeyword,
  resetWorkspace,
  generateSeoContent,
  hideMessage,
  copyResult,
} = useSeoWorkspace()
</script>

<template>
  <AppShell
    v-model:language="language"
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
      :copied-item-key="copiedItemKey"
      @copy="copyResult"
    />

    <SeoChatComposer
      v-model:instruction="instruction"
      v-model:page-topic="pageTopic"
      v-model:keyword-input="keywordInput"
      v-model:selected-model="selectedModel"
      :keywords="keywords"
      :models="models"
      :status="status"
      :instruction-character-count="instructionCharacterCount"
      :validation-errors="validationErrors"
      @add-keyword="addKeyword"
      @remove-keyword="removeKeyword"
      @generate="generateSeoContent(selectedModel)"
      @reset="resetWorkspace"
    />
  </AppShell>
</template>
