<script setup lang="ts">
import type { AgentRecentChat } from '../../types/agent-platform'

import { onClickOutside } from '@vueuse/core'
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{
  chat: AgentRecentChat
}>()

const emit = defineEmits<{
  deleteChat: [chatId: string]
  renameChat: [chatId: string, title: string]
  selectChat: [chatId: string]
}>()

const { t } = useI18n()
const menuRootRef = ref<HTMLElement | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const menuOpen = ref(false)
const editing = ref(false)
const titleDraft = ref(props.chat.title)

watch(
  () => props.chat.title,
  (title) => {
    if (!editing.value)
      titleDraft.value = title
  },
)

onClickOutside(menuRootRef, () => {
  menuOpen.value = false
})

function selectChat() {
  if (editing.value)
    return

  emit('selectChat', props.chat.id)
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

async function startRename() {
  menuOpen.value = false
  editing.value = true
  titleDraft.value = props.chat.title

  await nextTick()

  renameInputRef.value?.focus()
  renameInputRef.value?.select()
}

function submitRename() {
  if (!editing.value)
    return

  const nextTitle = titleDraft.value.trim()

  editing.value = false

  if (!nextTitle || nextTitle === props.chat.title) {
    titleDraft.value = props.chat.title
    return
  }

  emit('renameChat', props.chat.id, nextTitle)
}

function cancelRename() {
  editing.value = false
  titleDraft.value = props.chat.title
}

function deleteChat() {
  menuOpen.value = false
  emit('deleteChat', props.chat.id)
}
</script>

<template>
  <div
    class="group relative rounded-lg"
    :class="chat.active ? 'text-agent-ink' : 'text-agent-ink-soft hover:bg-agent-surface-sunken/45'"
  >
    <input
      v-if="editing"
      ref="renameInputRef"
      v-model="titleDraft"
      maxlength="80"
      class="h-9 w-full rounded-lg border border-agent-border bg-agent-sidebar px-3 pr-9 text-sm font-semibold text-agent-ink outline-none transition focus:border-agent-accent focus:ring-3 focus:ring-agent-focus/35"
      :aria-label="t('layout.sidebar.renameChat')"
      @blur="submitRename"
      @click.stop
      @keydown.enter.prevent="submitRename"
      @keydown.esc.prevent="cancelRename"
    >

    <button
      v-else
      type="button"
      class="flex h-9 w-full min-w-0 items-center rounded-lg px-3 pr-9 text-left text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40"
      :class="chat.active ? 'text-agent-ink' : 'text-agent-ink-soft'"
      @click="selectChat"
    >
      <span class="truncate">
        {{ chat.title }}
      </span>
    </button>

    <div
      ref="menuRootRef"
      class="absolute right-1 top-1"
    >
      <button
        v-if="!editing"
        type="button"
        :title="t('layout.sidebar.chatOptions')"
        :aria-label="t('layout.sidebar.chatOptions')"
        class="grid size-7 place-items-center rounded-md text-agent-ink-muted opacity-0 transition hover:bg-agent-surface-sunken hover:text-agent-ink focus:opacity-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40 group-hover:opacity-100"
        :class="{ 'opacity-100': menuOpen }"
        @click.stop="toggleMenu"
      >
        <AppIcon name="tabler:dots-vertical" :size="17" />
      </button>

      <div
        v-if="menuOpen"
        class="absolute right-0 top-full z-40 mt-1 w-36 rounded-xl border border-agent-border bg-agent-surface-raised p-1 shadow-[0_14px_36px_rgb(61_49_36/16%)]"
        @click.stop
      >
        <button
          type="button"
          class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-semibold text-agent-ink-soft transition hover:bg-agent-surface-sunken hover:text-agent-ink"
          @click="startRename"
        >
          <AppIcon name="tabler:pencil" :size="17" />
          <span>{{ t('layout.sidebar.renameChat') }}</span>
        </button>
        <button
          type="button"
          class="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-semibold text-agent-copper transition hover:bg-agent-copper-soft"
          @click="deleteChat"
        >
          <AppIcon name="tabler:trash" :size="17" />
          <span>{{ t('layout.sidebar.deleteChat') }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
