<script setup lang="ts">
import type { WorkspaceFile } from '@agent/contracts'

import type { AgentNavigationItem, AgentPlatformUser } from '../types/agent-platform'
import { userDisplayName, userInitial } from '@agent/contracts'
import { useElementSize } from '@vueuse/core'
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import workspaceBgOliveEmberDeepUrl from '../assets/bg-olive.webp'
import workspaceBgAiBalancedUrl from '../assets/bg-warm.webp'
import AgentConversation from '../components/agent/AgentConversation.vue'
import HtmlPreviewPanel from '../components/agent/HtmlPreviewPanel.vue'
import WorkspaceFilesPanel from '../components/agent/WorkspaceFilesPanel.vue'
import ChatComposer from '../components/chat/ChatComposer.vue'
import AppIcon from '../components/common/AppIcon.vue'
import AppMessage from '../components/common/AppMessage.vue'
import AppTooltip from '../components/common/AppTooltip.vue'
import AppShell from '../components/layout/AppShell.vue'
import { useAuth } from '../hooks/useAuth'
import { useChatWorkspace } from '../hooks/useChatWorkspace'
import { useHtmlPreview } from '../hooks/useHtmlPreview'
import { useLlmRuntime } from '../hooks/useLlmRuntime'
import { useWorkspaceFiles } from '../hooks/useWorkspaceFiles'
import { useWorkspaceTheme } from '../hooks/useWorkspaceTheme'

const navigationConfig = [
  { id: 'knowledge-qa', labelKey: 'navigation.knowledgeQa', icon: 'tabler:file-search', active: true },
  { id: 'article-search', labelKey: 'navigation.articleSearch', icon: 'tabler:bulb' },
  { id: 'run-trace', labelKey: 'navigation.runTrace', icon: 'tabler:checklist' },
  { id: 'history', labelKey: 'navigation.history', icon: 'tabler:history' },
  { id: 'settings', labelKey: 'navigation.settings', icon: 'tabler:settings' },
] as const

const { t } = useI18n()
const router = useRouter()
const { currentUser, signOut } = useAuth()

const user = computed<AgentPlatformUser>(() => currentUser.value
  ? { name: userDisplayName(currentUser.value), initial: userInitial(currentUser.value), avatarUrl: currentUser.value.avatarUrl }
  : { name: '', initial: '', avatarUrl: null })

const {
  workspaceTheme,
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
  modelError,
  modelNotice,
  loadModels,
  dismissModelNotice,
  refreshBalance,
} = useLlmRuntime()

const {
  message,
  status,
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
  showMessage,
  hideMessage,
} = useChatWorkspace({ onModelUnavailable: loadModels })

const composer = ref<InstanceType<typeof ChatComposer> | null>(null)
const workspaceElement = ref<HTMLElement | null>(null)
const { width: workspaceWidth } = useElementSize(workspaceElement)
const splitPreview = computed(() => workspaceWidth.value >= 720)
const minPanelSize = computed(() => 320 / Math.max(716, workspaceWidth.value - 4) * 100)
const previewDragging = ref(false)
const chatPanel = ref<InstanceType<typeof SplitterPanel> | null>(null)
const { isOpen: previewOpen, source: previewSource, close: closePreview, layout: previewLayout, rememberLayout } = useHtmlPreview(activeConversationId)
const previewCode = computed(() => previewSource.value?.() ?? '')
const filesOpen = ref(false)
const filesPanel = ref<InstanceType<typeof WorkspaceFilesPanel> | null>(null)
const openingArtifact = ref(false)
// 与 loading 分离：交付打开被重建取消后，仍不能自动改选当前最新文件。
const filesAutoPreview = ref(true)
let artifactRequest = 0
const sideOpen = computed(() => previewOpen.value || filesOpen.value)
const { snapshot: workspaceSnapshot, loading: workspaceLoading, error: workspaceError, refresh: refreshFiles, readFile } = useWorkspaceFiles(activeConversationId, status)
let openedFilesFor: string | null = null
watch(previewOpen, (open) => {
  if (open) {
    filesOpen.value = false
    artifactRequest++
    openingArtifact.value = false
  }
})
watch(activeConversationId, () => {
  filesOpen.value = false
  artifactRequest++
  openingArtifact.value = false
  filesAutoPreview.value = true
  openedFilesFor = null
})
watch(filesOpen, (open) => {
  if (!open) {
    artifactRequest++
    openingArtifact.value = false
  }
}, { flush: 'sync' })
watch(splitPreview, () => {
  if (filesOpen.value && !filesAutoPreview.value) {
    // 两个布局会重建面板：明确取消旧打开，让用户重新选择，不让旧 finally 恢复自动预览。
    artifactRequest++
    openingArtifact.value = false
    showMessage(t('workspace.selectFile'))
  }
}, { flush: 'sync' })
watch(workspaceSnapshot, (snapshot) => {
  if (snapshot?.files.length && openedFilesFor !== activeConversationId.value) {
    openedFilesFor = activeConversationId.value
    if (!openingArtifact.value) {
      filesOpen.value = true
      void closePreview()
    }
  }
})
async function openFiles(file?: WorkspaceFile) {
  if (openingArtifact.value)
    return
  const conversationId = activeConversationId.value
  // 交付卡先确认内容身份再挂载面板，避免自动预览或 revision watcher 抢先打开新内容。
  if (file)
    filesOpen.value = false
  const request = ++artifactRequest
  filesAutoPreview.value = !file
  openingArtifact.value = !!file
  void closePreview()
  if (!file)
    filesOpen.value = true
  try {
    await refreshFiles()
    if (!file || request !== artifactRequest || activeConversationId.value !== conversationId)
      return
    if (workspaceError.value || !workspaceSnapshot.value?.files.some(current => current.path === file.path && current.sha256 === file.sha256)) {
      showMessage(t('workspace.fileFailed'), 'error')
      return
    }
    filesOpen.value = true
    await nextTick()
    if (request === artifactRequest && activeConversationId.value === conversationId && filesOpen.value)
      await filesPanel.value?.openFile(file.path, file.sha256)
  }
  finally {
    if (request === artifactRequest)
      openingArtifact.value = false
  }
}

watch([sideOpen, splitPreview], async ([open, split]) => {
  if (!open || !split) {
    // Reka 通过 window mouseup 结束拖动；在收起/窄屏前主动结束，避免 iframe 吞掉晚到的松手。
    if (previewDragging.value) {
      window.dispatchEvent(new MouseEvent('mouseup'))
      previewDragging.value = false
    }
    return
  }
  // 打开或恢复分栏后还原上次比例，两侧的最小宽度仍由 Splitter 约束。
  const savedSize = previewLayout.value[0] ?? 50
  await nextTick()
  if (sideOpen.value && splitPreview.value)
    chatPanel.value?.resize(savedSize)
}, { flush: 'sync' })

function onPreviewLayout(sizes: number[]) {
  // 关闭时左栏放宽/右栏注销的过渡布局不能覆盖用户最后调整的比例。
  if (sideOpen.value && splitPreview.value)
    rememberLayout(sizes)
}

async function newChat() {
  resetWorkspace()
  await nextTick()
  composer.value?.focus()
}

async function logout() {
  try {
    await signOut()
  }
  catch {
    showMessage(t('auth.logoutFailed'), 'error')
    return
  }

  // 主动退出回首页，不弹登录框
  await router.replace('/')
}

// 请求真正发出（未被节流 / 生成中拦下）才算用户已经看到模型替换提示。
watch(status, (next) => {
  if (next === 'thinking')
    dismissModelNotice()
})

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
    @change-password="router.push({ name: 'change-password', query: { redirect: '/workspace' } })"
    @delete-chat="deleteConversationById"
    @focus-composer="composer?.focus()"
    @load-more-chats="loadMoreConversations"
    @logout="logout"
    @new-chat="newChat"
    @refresh-balance="refreshBalance"
    @rename-chat="renameConversationById"
    @select-chat="selectConversation"
  >
    <div ref="workspaceElement" class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <AppMessage
        :visible="appMessage.visible"
        :type="appMessage.type"
        :text="appMessage.text"
        @close="hideMessage"
      />

      <SplitterGroup direction="horizontal" class="relative z-10 min-h-0 flex-1" @layout="onPreviewLayout">
        <SplitterPanel id="chat" ref="chatPanel" :default-size="previewLayout[0]" :min-size="sideOpen && splitPreview ? minPanelSize : 0" :style="sideOpen && splitPreview ? { minWidth: '320px' } : undefined" class="flex min-h-0 min-w-0 flex-col">
          <div
            v-if="showConversationEmptyState"
            class="relative z-10 flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-6 pt-14 sm:px-6"
          >
            <div class="my-auto w-full max-w-[720px] pb-[8dvh]">
              <h2 class="workspace-greeting text-center text-[28px] leading-snug text-agent-ink sm:text-[34px]">
                <AppIcon name="tabler:asterisk" :size="26" class="mr-1.5 inline-block align-[-0.2em] text-agent-accent" />{{ t('conversation.emptyTitle') }}
              </h2>

              <ChatComposer
                ref="composer"
                v-model:message="message"
                v-model:selected-model="selectedModel"
                v-model:selected-reasoning-effort="selectedReasoningEffort"
                hero
                class="mt-10"
                :models="models"
                :model-error="modelError"
                :model-notice="modelNotice"
                :status="status"
                :message-character-count="messageCharacterCount"
                @refresh-models="loadModels"
                @send="send"
                @stop="stopGeneration"
              />

              <div class="mt-6 flex flex-wrap justify-center gap-2">
                <button
                  v-for="prompt in starterPrompts"
                  :key="prompt.key"
                  type="button"
                  class="inline-flex h-8 items-center rounded-full border border-agent-border-soft px-3 text-[13px] text-agent-ink-soft transition hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
                  @click="applySuggestedPrompt(prompt.prompt)"
                >
                  {{ prompt.label }}
                </button>
              </div>
            </div>
          </div>

          <div v-else data-chat-pane :inert="sideOpen && !splitPreview || undefined" class="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
            <div v-if="activeConversationId" class="flex shrink-0 justify-end px-4 pt-2">
              <AppTooltip :content="t('workspace.files')">
                <button type="button" data-open-workspace-files :aria-label="t('workspace.files')" :aria-expanded="filesOpen" class="grid size-8 place-items-center rounded-md text-agent-ink-muted hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-agent-focus" @click="openFiles()">
                  <AppIcon name="tabler:folder" :size="18" />
                </button>
              </AppTooltip>
            </div>
            <AgentConversation
              :anchor-latest-turn="shouldAnchorLatestTurn"
              :conversation-id="activeConversationId"
              :is-loading-messages="isLoadingMessages"
              :turns="conversationTurns"
              :workspace-files="workspaceSnapshot?.files ?? []"
              :opening-artifact="openingArtifact"
              @open-file="openFiles"
            />

            <ChatComposer
              ref="composer"
              v-model:message="message"
              v-model:selected-model="selectedModel"
              v-model:selected-reasoning-effort="selectedReasoningEffort"
              :models="models"
              :model-error="modelError"
              :model-notice="modelNotice"
              :status="status"
              :message-character-count="messageCharacterCount"
              @refresh-models="loadModels"
              @send="send"
              @stop="stopGeneration"
            />
          </div>
        </SplitterPanel>
        <SplitterResizeHandle
          v-show="sideOpen && splitPreview"
          :aria-label="t('conversation.actions.codeBlock.resizePreview')"
          class="relative w-1 shrink-0 bg-agent-border-soft outline-none transition-colors hover:bg-agent-accent focus-visible:bg-agent-accent data-[state=drag]:bg-agent-accent"
          @dragging="previewDragging = $event"
        />
        <SplitterPanel v-show="sideOpen && splitPreview" id="preview" :default-size="previewLayout[1]" :min-size="sideOpen && splitPreview ? minPanelSize : 0" style="min-width: 320px" class="flex min-h-0 min-w-0">
          <HtmlPreviewPanel v-if="previewOpen && splitPreview" :code="previewCode" @close="closePreview" />
          <WorkspaceFilesPanel v-if="filesOpen && splitPreview" ref="filesPanel" :snapshot="workspaceSnapshot" :loading="workspaceLoading" :error="workspaceError" :conversation-id="activeConversationId" :read-file="readFile" :auto-preview="filesAutoPreview" @refresh="refreshFiles" @close="filesOpen = false" />
        </SplitterPanel>
      </SplitterGroup>
      <HtmlPreviewPanel
        v-if="previewOpen && !splitPreview"
        :code="previewCode"
        focus-close
        class="absolute inset-0 z-40"
        @close="closePreview"
      />
      <WorkspaceFilesPanel v-if="filesOpen && !splitPreview" ref="filesPanel" :snapshot="workspaceSnapshot" :loading="workspaceLoading" :error="workspaceError" :conversation-id="activeConversationId" :read-file="readFile" :auto-preview="filesAutoPreview" class="absolute inset-0 z-40" @refresh="refreshFiles" @close="filesOpen = false" />
    </div>
  </AppShell>
</template>

<style scoped>
.workspace-greeting {
  font-family: "Libre Baskerville", Georgia, "Songti SC", "Noto Serif SC", ui-serif, serif;
  text-wrap: balance;
}
</style>
