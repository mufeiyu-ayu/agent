<script setup lang="ts">
import { Empty } from 'ant-design-vue'

defineProps<{
  title: string
  description: string
}>()

const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE
</script>

<template>
  <div class="empty-state">
    <Empty :image="simpleImage">
      <template #description>
        <strong>{{ title }}</strong>
        <p>{{ description }}</p>
      </template>
    </Empty>
  </div>
</template>

<style scoped>
.empty-state {
  display: grid;
  min-height: 310px;
  place-items: center;
  border: 1px dashed var(--admin-border-strong);
  border-radius: 10px;
  background: var(--admin-surface);
}

.empty-state strong {
  display: block;
  margin-bottom: 5px;
  color: var(--admin-text);
  font-size: 14px;
}

.empty-state p {
  max-width: 420px;
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
}
</style>
