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
/* 每个分组是一张浮在次级面板底色上的内容卡，边界由卡片承担，行间不再画横线。 */
.inspector-field-list {
  padding: 14px 16px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface-raised);
  box-shadow: var(--admin-shadow-sm);
}

.inspector-field-list + .inspector-field-list {
  margin-top: 12px;
}

.inspector-field-list h4 {
  margin: 0 0 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--admin-border);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

/* label 定宽，value 紧跟左对齐，短值不再被比例列推开 */
.inspector-field-list dl {
  display: grid;
  margin: 0;
  grid-template-columns: 128px minmax(0, 1fr);
  column-gap: 16px;
}

.inspector-field-list dl > :is(dt, dd) {
  margin: 0;
  padding-block: 7px;
}

.inspector-field-list dt {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.5;
}

.inspector-field-list dd {
  min-width: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 550;
  line-height: 1.5;
  overflow-wrap: anywhere;
  text-align: left;
}

.inspector-field-list dd.is-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
}

/* 窄面板下收紧 label 列，给长 ID / 时间戳留出值宽 */
@container trace-inspector (max-width: 380px) {
  .inspector-field-list dl {
    grid-template-columns: 104px minmax(0, 1fr);
    column-gap: 12px;
  }
}
</style>
