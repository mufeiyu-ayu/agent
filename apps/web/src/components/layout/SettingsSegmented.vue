<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { computed } from 'vue'

import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{
  modelValue: string
  options: readonly { value: string, label: string, icon?: string }[]
  groupLabel: string
  /** 只显示图标，文字作为无障碍名称。 */
  iconOnly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const selectedIndex = computed(() => Math.max(0, props.options.findIndex(option => option.value === props.modelValue)))
</script>

<template>
  <!-- 单选组语义：方向键在选项间移动；滑块按选中下标平移。槽与滑块颜色取自 SettingsDialog 面板上的变量 -->
  <RadioGroupRoot
    :model-value="modelValue"
    :aria-label="groupLabel"
    orientation="horizontal"
    class="segmented-track relative grid shrink-0 auto-cols-fr grid-flow-col rounded-lg p-px"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <span
      aria-hidden="true"
      class="segmented-thumb pointer-events-none absolute inset-y-px left-px rounded-[7px]"
      :style="{
        width: `calc((100% - 2px) / ${options.length})`,
        transform: `translateX(${selectedIndex * 100}%)`,
      }"
    />
    <RadioGroupItem
      v-for="option in options"
      :key="option.value"
      :value="option.value"
      :aria-label="iconOnly ? option.label : undefined"
      class="relative z-10 flex h-[30px] cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm text-agent-ink-faint outline-none transition-colors duration-200 hover:text-agent-ink focus-visible:ring-2 focus-visible:ring-agent-focus/45 data-[state=checked]:text-agent-ink"
      :class="iconOnly ? 'w-[30px]' : 'px-3'"
    >
      <AppIcon v-if="option.icon" :name="option.icon" :size="16" />
      <template v-if="!iconOnly">
        {{ option.label }}
      </template>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.segmented-track {
  background: var(--settings-track);
}

.segmented-thumb {
  background: var(--settings-thumb);
  box-shadow: inset 0 0 0 1px var(--settings-edge), 0 1px 2px rgb(0 0 0 / 5%);
  transition: transform 180ms ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .segmented-thumb { transition: none; }
}
</style>
