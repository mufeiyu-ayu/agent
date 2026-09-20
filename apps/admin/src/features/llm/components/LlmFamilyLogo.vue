<script setup lang="ts">
import type { LlmProviderFamily } from '@agent/contracts'
import { ApiOutlined } from '@ant-design/icons-vue'
import { computed } from 'vue'

import { LLM_FAMILY_BRAND } from '../llm-families'

const props = withDefaults(defineProps<{
  family: LlmProviderFamily
  size?: number
  /** 带浅色方形底框，用在列表行首。 */
  badge?: boolean
}>(), {
  size: 16,
  badge: false,
})

const brand = computed(() => LLM_FAMILY_BRAND[props.family])
const logoStyle = computed(() => ({ color: brand.value.color, transform: `scale(${brand.value.logoScale})` }))
</script>

<template>
  <span class="family-logo-wrap" :class="{ 'is-badge': badge }">
    <svg
      v-if="brand.logoPath"
      class="family-logo"
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      aria-hidden="true"
      :style="logoStyle"
    >
      <path :d="brand.logoPath" fill="currentColor" />
    </svg>
    <ApiOutlined v-else class="family-logo" :style="{ fontSize: `${size}px`, ...logoStyle }" />
  </span>
</template>

<style scoped>
.family-logo-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.family-logo-wrap.is-badge {
  width: 22px;
  height: 22px;
  border-radius: var(--admin-radius-sm, 6px);
  background: var(--admin-surface-muted);
  border: 1px solid var(--admin-border);
  overflow: hidden;
}

.family-logo {
  flex: 0 0 auto;
  vertical-align: -0.125em;
  transform-origin: center;
}
</style>
