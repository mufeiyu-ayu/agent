<script setup lang="ts">
import type { LlmProviderFamily } from '@agent/contracts'
import { ApiOutlined } from '@ant-design/icons-vue'
import { computed } from 'vue'

import { LLM_FAMILY_LOGO_PATHS } from '../llm-family-logos'
import { getLlmProviderPreset } from '../llm-presets'

const props = withDefaults(defineProps<{
  family: LlmProviderFamily
  size?: number
}>(), { size: 16 })

const path = computed(() => LLM_FAMILY_LOGO_PATHS[props.family])
const color = computed(() => getLlmProviderPreset(props.family).color)
</script>

<template>
  <svg
    v-if="path"
    class="family-logo"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    aria-hidden="true"
    :style="{ color }"
  >
    <path :d="path" fill="currentColor" />
  </svg>
  <ApiOutlined v-else class="family-logo" :style="{ fontSize: `${size}px`, color }" />
</template>

<style scoped>
.family-logo {
  flex: 0 0 auto;
  vertical-align: -0.125em;
}
</style>
