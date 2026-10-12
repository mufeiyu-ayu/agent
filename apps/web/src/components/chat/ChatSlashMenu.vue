<script setup lang="ts">
import type { SkillSummary } from '@agent/contracts'
import { onClickOutside } from '@vueuse/core'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'

defineProps<{
  skills: SkillSummary[]
  activeIndex: number
  side: 'top' | 'bottom'
}>()

const emit = defineEmits<{
  select: [skill: SkillSummary]
  hover: [index: number]
  close: []
}>()

const { t } = useI18n()

const menuRef = ref<HTMLElement | null>(null)
onClickOutside(menuRef, () => {
  emit('close')
})
</script>

<template>
  <div
    ref="menuRef"
    role="listbox"
    :aria-label="t('skills.slashLabel')"
    class="absolute left-0 right-0 z-50 flex max-h-72 flex-col overflow-hidden rounded-2xl border border-agent-border-subtle bg-agent-surface-raised p-1.5 shadow-2xl transition-all"
    :class="side === 'bottom' ? 'top-[calc(100%+8px)]' : 'bottom-[calc(100%+8px)]'"
  >
    <!-- 分组标题 -->
    <div class="px-2 pb-1 pt-0.5 text-[11px] font-medium text-agent-ink-faint">
      {{ t('skills.title') }}
    </div>

    <!-- 技能项列表滚动区域 -->
    <div class="min-h-0 flex-1 overflow-y-auto space-y-0.5">
      <button
        v-for="(skill, index) in skills"
        :key="skill.id"
        type="button"
        role="option"
        :aria-selected="activeIndex === index"
        class="group flex h-7.5 w-full items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors"
        :class="activeIndex === index ? 'bg-agent-ink/[0.06] text-agent-ink' : 'text-agent-ink-soft hover:bg-agent-ink/[0.035] hover:text-agent-ink'"
        @click="emit('select', skill)"
        @mouseenter="emit('hover', index)"
      >
        <!-- 紧凑原生图标 -->
        <AppIcon name="tabler:script" :size="14" class="shrink-0 text-agent-ink-muted group-hover:text-agent-ink" />

        <!-- 技能名称 -->
        <span class="shrink-0 font-mono text-xs font-medium text-agent-ink">
          {{ skill.name }}
        </span>

        <!-- 技能描述 -->
        <span class="min-w-0 flex-1 truncate text-xs text-agent-ink-muted">
          {{ skill.description || t('skills.noDescription') }}
        </span>
      </button>
    </div>
  </div>
</template>
