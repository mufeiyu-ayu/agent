<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  description: string
}>()
</script>

<template>
  <header class="page-header">
    <div>
      <span v-if="eyebrow" class="page-header__eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.page-header__eyebrow {
  display: block;
  margin-bottom: 7px;
  color: var(--admin-primary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  color: var(--admin-text);
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

p {
  max-width: 680px;
  margin: 7px 0 0;
  color: var(--admin-text-muted);
  font-size: 13px;
  line-height: 1.65;
}

.page-header__actions {
  flex: 0 0 auto;
}
</style>
