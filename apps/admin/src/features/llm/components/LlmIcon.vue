<script setup lang="ts">
import { computed } from 'vue'

export type LlmIconName = 'edit' | 'delete' | 'refresh' | 'globe' | 'key'

withDefaults(defineProps<{
  name: LlmIconName
  size?: number
  strokeWidth?: number
}>(), {
  size: 14,
  strokeWidth: 1.75,
})

const viewBox = computed(() => '0 0 24 24')
</script>

<template>
  <svg
    class="llm-icon"
    :width="size"
    :height="size"
    :viewBox="viewBox"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 1. 编辑：现代精细 Pencil -->
    <g v-if="name === 'edit'">
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </g>

    <!-- 2. 删除：轻盈现代 Trash-2 -->
    <g v-else-if="name === 'delete'">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </g>

    <!-- 3. 刷新 / 探测：双向圆环 Refresh-cw -->
    <g v-else-if="name === 'refresh'">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </g>

    <!-- 4. 网络地址：精致细经纬线 Globe -->
    <g v-else-if="name === 'globe'">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </g>

    <!-- 5. 密钥：极简斜向 Key -->
    <g v-else-if="name === 'key'">
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="16.5" r="4.5" />
    </g>
  </svg>
</template>

<style scoped>
.llm-icon {
  display: inline-block;
  vertical-align: -0.125em;
  flex-shrink: 0;
  transition: transform 120ms ease;
}
</style>
