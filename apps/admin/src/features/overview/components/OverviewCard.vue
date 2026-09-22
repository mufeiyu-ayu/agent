<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <section class="overview-card">
    <header class="overview-card__head">
      <div class="overview-card__titles">
        <h2 class="overview-card__title">
          {{ title }}
        </h2>
        <p v-if="subtitle" class="overview-card__subtitle">
          {{ subtitle }}
        </p>
      </div>
      <div v-if="$slots.actions" class="overview-card__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="overview-card__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.overview-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--admin-border);
  border-radius: 12px;
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
  padding: 16px 20px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.overview-card:hover {
  border-color: var(--admin-border-strong);
  box-shadow: var(--admin-shadow-md);
}

.overview-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.overview-card__titles {
  min-width: 0;
}

.overview-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.overview-card__subtitle {
  margin: 2px 0 0;
  color: var(--admin-text-subtle);
  font-size: 11px;
}

.overview-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.overview-card__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
</style>
