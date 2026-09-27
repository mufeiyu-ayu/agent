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
  display: flex;
  width: min(1180px, 100%);
  flex: 1;
  flex-direction: column;
  margin: 0 auto;
  padding-bottom: 24px;
}

.page-container.is-wide {
  width: 100%;
}
</style>
