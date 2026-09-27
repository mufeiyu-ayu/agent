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
/* 概览分区不再是卡片：直接铺在内容面板上，分区之间由父级的细线隔开 */
.overview-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 18px 4px 20px;
}

.overview-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.overview-card__titles {
  min-width: 0;
}

.overview-card__title {
  margin: 0;
  color: var(--admin-text);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.overview-card__subtitle {
  margin: 3px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
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
