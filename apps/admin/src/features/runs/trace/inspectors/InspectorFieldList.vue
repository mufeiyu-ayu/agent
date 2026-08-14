<script setup lang="ts">
export interface InspectorField {
  label: string
  value: string | number
  mono?: boolean
}

defineProps<{
  items: InspectorField[]
  title?: string
}>()
</script>

<template>
  <section class="inspector-field-list">
    <h4 v-if="title">
      {{ title }}
    </h4>

    <dl>
      <template v-for="item in items" :key="item.label">
        <dt>{{ item.label }}</dt>
        <dd :class="{ 'is-mono': item.mono }" :title="String(item.value)">
          {{ item.value }}
        </dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.inspector-field-list + .inspector-field-list {
  margin-top: 22px;
}

.inspector-field-list h4 {
  margin: 0 0 10px;
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.inspector-field-list dl {
  margin: 0;
  border-top: 1px solid var(--admin-border);
}

.inspector-field-list dl > :is(dt, dd) {
  margin: 0;
  padding-block: 11px;
  border-bottom: 1px solid var(--admin-border);
}

.inspector-field-list dl {
  display: grid;
  grid-template-columns: minmax(112px, 0.8fr) minmax(0, 1.2fr);
  column-gap: 12px;
}

.inspector-field-list dt {
  color: var(--admin-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.inspector-field-list dd {
  min-width: 0;
  color: var(--admin-text);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-align: left;
}

.inspector-field-list dd.is-mono {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
</style>
