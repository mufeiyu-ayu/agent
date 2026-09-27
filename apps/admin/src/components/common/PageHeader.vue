<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header class="page-header">
    <div class="page-header__titles">
      <h1>{{ title }}</h1>
      <p v-if="description">
        {{ description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 4px 4px 18px;
}

.page-header__titles {
  min-width: 0;
}

h1 {
  margin: 0;
  color: var(--admin-text);
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

p {
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

.page-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}
</style>
