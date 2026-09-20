<script setup lang="ts">
import type { LlmProviderFamily } from '@agent/contracts'
import { ApiOutlined } from '@ant-design/icons-vue'
import { computed } from 'vue'

import { LLM_FAMILY_LOGO_PATHS } from '../llm-family-logos'
import { getLlmProviderPreset } from '../llm-presets'

const props = withDefaults(defineProps<{
  family: LlmProviderFamily
  size?: number
  badge?: boolean
}>(), {
  size: 16,
  badge: false,
})

const path = computed(() => LLM_FAMILY_LOGO_PATHS[props.family])
const color = computed(() => getLlmProviderPreset(props.family).color)

/**
 * 各家图标视觉墨水覆盖率差异极大：
 * - openai: 几乎占满 24x24，大面积实心色块
 * - gemini: 极细的四角内凹星形，实心面积不足 openai 的 1/5，需大幅放大平衡视觉重量
 * - deepseek: 单线条白描小鲸鱼，上下大片留白，适度放大
 * - grok: 斜向细线条环，适度放大
 * - claude: 细放射线，适度放大
 */
const OPTICAL_SCALES: Record<LlmProviderFamily, number> = {
  openai: 1.0,
  gemini: 1.34,
  deepseek: 1.2,
  grok: 1.18,
  claude: 1.16,
  other: 1.05,
}

const scale = computed(() => OPTICAL_SCALES[props.family] ?? 1.0)
</script>

<template>
  <div v-if="badge" class="family-logo-badge" :class="`is-${family}`">
    <svg
      v-if="path"
      class="family-logo"
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      aria-hidden="true"
      :style="{ color, transform: `scale(${scale})` }"
    >
      <path :d="path" fill="currentColor" />
    </svg>
    <ApiOutlined
      v-else
      class="family-logo"
      :style="{ fontSize: `${size}px`, color, transform: `scale(${scale})` }"
    />
  </div>
  <template v-else>
    <svg
      v-if="path"
      class="family-logo"
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      aria-hidden="true"
      :style="{ color, transform: `scale(${scale})` }"
    >
      <path :d="path" fill="currentColor" />
    </svg>
    <ApiOutlined
      v-else
      class="family-logo"
      :style="{ fontSize: `${size}px`, color, transform: `scale(${scale})` }"
    />
  </template>
</template>

<style scoped>
.family-logo {
  flex: 0 0 auto;
  vertical-align: -0.125em;
  transform-origin: center;
  transition: transform 120ms ease;
}

.family-logo-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--admin-radius-sm, 6px);
  background: var(--admin-surface-muted);
  border: 1px solid var(--admin-border);
  flex-shrink: 0;
  overflow: hidden;
}
</style>
