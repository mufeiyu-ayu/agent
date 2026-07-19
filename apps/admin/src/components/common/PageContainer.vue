<script setup lang="ts">
defineProps<{
  wide?: boolean
}>()
</script>

<template>
  <section class="page-container" :class="{ 'is-wide': wide }">
    <slot />
  </section>
</template>

<style scoped>
.page-container {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.page-container.is-wide {
  width: 100%;
}
</style>
