<script setup lang="ts">
import { Icon } from '@iconify/vue'

withDefaults(defineProps<{
  name: string
  size?: number | string
  label?: string
  decorative?: boolean
}>(), {
  size: 18,
  decorative: true,
})
</script>

<template>
  <Icon
    :icon="name"
    :width="size"
    :height="size"
    :inline="true"
    :role="decorative ? undefined : 'img'"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="decorative ? undefined : label"
    class="inline-block shrink-0 align-[-0.125em]"
  />
</template>
