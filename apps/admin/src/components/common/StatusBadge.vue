<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'neutral' | 'info' | 'success'
}>(), {
  tone: 'neutral',
})
</script>

<template>
  <span class="status-badge" :class="`is-${tone}`">
    <i />
    <slot />
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--admin-border);
  border-radius: 999px;
  color: var(--admin-text-muted);
  background: var(--admin-surface);
  font-size: 11px;
  font-weight: 600;
}

.status-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--admin-text-subtle);
}

.status-badge.is-info {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.status-badge.is-info i {
  background: var(--admin-primary);
}

.status-badge.is-success {
  color: var(--admin-success-strong);
  background: var(--admin-success-soft);
}

.status-badge.is-success i {
  background: var(--admin-success);
}
</style>
