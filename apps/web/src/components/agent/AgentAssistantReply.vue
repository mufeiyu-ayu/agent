<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{
  text: string
}>()

const { t } = useI18n()
const copied = ref(false)
let resetCopiedTimer: number | undefined

const replyActions = computed(() => [
  {
    id: 'copy',
    icon: copied.value ? 'tabler:check' : 'tabler:copy',
    label: copied.value ? t('conversation.actions.copiedReply') : t('conversation.actions.copyReply'),
    toneClass: copied.value ? 'text-agent-moss' : 'text-agent-ink-muted hover:text-agent-ink',
    disabled: !props.text.trim(),
  },
])

async function copyReply() {
  const text = props.text.trim()

  if (!text)
    return

  try {
    await writeClipboardText(text)
    markCopied()
  }
  catch {
    copied.value = false
  }
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')

  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.inset = '-9999px'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function markCopied() {
  copied.value = true

  if (resetCopiedTimer !== undefined)
    window.clearTimeout(resetCopiedTimer)

  resetCopiedTimer = window.setTimeout(() => {
    copied.value = false
    resetCopiedTimer = undefined
  }, 1600)
}

function handleAction(actionId: string, event: MouseEvent) {
  if (event.detail > 0)
    (event.currentTarget as HTMLButtonElement | null)?.blur()

  if (actionId === 'copy')
    void copyReply()
}

onUnmounted(() => {
  if (resetCopiedTimer !== undefined)
    window.clearTimeout(resetCopiedTimer)
})
</script>

<template>
  <div class="group/reply max-w-[760px] pt-1">
    <div class="whitespace-pre-wrap text-[15px] font-medium leading-7 text-agent-ink-soft">
      {{ text }}
    </div>

    <div class="mt-2 flex h-8 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/reply:opacity-100 group-focus-within/reply:opacity-100">
      <button
        v-for="action in replyActions"
        :key="action.id"
        type="button"
        :title="action.label"
        :aria-label="action.label"
        class="grid size-7 place-items-center rounded-lg transition hover:bg-agent-surface-sunken focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/40 disabled:pointer-events-none disabled:opacity-45"
        :class="action.toneClass"
        :disabled="action.disabled"
        @click="handleAction(action.id, $event)"
      >
        <AppIcon :name="action.icon" :size="15" />
      </button>
    </div>
  </div>
</template>
