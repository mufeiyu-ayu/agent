<script setup lang="ts">
import type { ChatSlashItem } from '@/types/chat'
import { onClickOutside } from '@vueuse/core'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'
import { pluginIconName } from '@/utils/plugin-icon-name'
import { pluginText } from '@/utils/plugin-text'

defineProps<{
  items: ChatSlashItem[]
  pluginsLoading?: boolean
  pluginsError?: boolean
  activeIndex: number
  side: 'top' | 'bottom'
}>()

const emit = defineEmits<{
  select: [item: ChatSlashItem]
  hover: [index: number]
  close: []
}>()

const { locale, t } = useI18n()

const menuRef = ref<HTMLElement | null>(null)
onClickOutside(menuRef, () => {
  emit('close')
})
</script>

<template>
  <div
    ref="menuRef"
    role="listbox"
    :aria-label="t('plugins.slashLabel')"
    class="absolute left-0 right-0 z-50 flex max-h-72 flex-col overflow-hidden rounded-2xl border border-agent-border-subtle bg-agent-surface-raised p-1.5 shadow-2xl transition-all"
    :class="side === 'bottom' ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'"
  >
    <div class="min-h-0 flex-1 overflow-y-auto space-y-0.5">
      <template v-for="(item, index) in items" :key="`${item.kind}:${item.id}`">
        <div v-if="index === 0 || items[index - 1]?.kind !== item.kind" class="px-2 pb-1 pt-0.5 text-[11px] font-medium text-agent-ink-faint">
          {{ t(item.kind === 'skill' ? 'skills.title' : 'plugins.title') }}
        </div>
        <button
          type="button"
          role="option"
          :aria-selected="activeIndex === index"
          class="group flex h-7.5 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
          :class="activeIndex === index ? 'bg-agent-ink/[0.06] text-agent-ink' : 'text-agent-ink-soft hover:bg-agent-ink/[0.035] hover:text-agent-ink'"
          @click="emit('select', item)"
          @mouseenter="emit('hover', index)"
        >
          <img v-if="item.icon" :src="item.icon" alt="" class="size-3.5 shrink-0 object-contain">
          <AppIcon v-else :name="item.kind === 'skill' ? 'tabler:script' : pluginIconName(item.id)" :size="14" class="shrink-0 text-agent-ink-muted group-hover:text-agent-ink" />
          <span class="shrink-0 font-mono text-xs font-medium text-agent-ink">{{ item.kind === 'plugin' ? pluginText(item, 'name', locale) : item.name }}</span>
          <span class="min-w-0 flex-1 truncate text-xs text-agent-ink-muted">{{ (item.kind === 'plugin' ? pluginText(item, 'description', locale) : item.description) || t('skills.noDescription') }}</span>
        </button>
      </template>
      <p v-if="pluginsLoading || pluginsError" role="status" class="px-2 py-1 text-xs text-agent-ink-muted">
        {{ t(pluginsLoading ? 'plugins.loading' : 'plugins.loadFailed') }}
      </p>
    </div>
  </div>
</template>
