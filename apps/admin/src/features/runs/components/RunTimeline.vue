<script setup lang="ts">
import type { Component } from 'vue'
import type { RunTimelineItem } from '../run.model'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  StopOutlined,
  ToolOutlined,
} from '@ant-design/icons-vue'
import { Tag } from 'ant-design-vue'

import { formatDuration, formatTime } from '../run.utils'

defineProps<{
  items: RunTimelineItem[]
  selectedId: string | undefined
}>()

defineEmits<{
  select: [itemId: string]
}>()

function timelineIcon(item: RunTimelineItem): Component {
  switch (item.type) {
    case 'run_lifecycle':
      if (item.event === 'run_started')
        return PlayCircleOutlined
      if (item.event === 'run_failed')
        return CloseCircleOutlined
      if (item.event === 'run_aborted')
        return StopOutlined
      return CheckCircleOutlined
    case 'receive_user_message':
      return MessageOutlined
    case 'load_conversation_history':
      return DatabaseOutlined
    case 'model_sampling':
      return RobotOutlined
    case 'tool_execution':
      return ToolOutlined
    case 'assistant_output':
      return CheckCircleOutlined
    default:
      return ClockCircleOutlined
  }
}
</script>

<template>
  <div class="run-timeline" aria-label="Execution Timeline">
    <div
      v-for="item in items"
      :key="item.id"
      class="run-timeline__row"
      :class="[
        `is-${item.status.toLowerCase()}`,
        { 'is-derived': item.kind === 'derived_lifecycle' },
      ]"
    >
      <span class="run-timeline__marker">
        <component :is="timelineIcon(item)" />
      </span>

      <button
        type="button"
        class="run-timeline__item"
        :class="{ 'is-selected': selectedId === item.id }"
        :aria-pressed="selectedId === item.id"
        @click="$emit('select', item.id)"
      >
        <span class="run-timeline__heading">
          <strong>{{ item.title }}</strong>
          <time>{{ formatTime(item.startedAt) }}</time>
        </span>
        <span class="run-timeline__meta">
          <Tag v-if="item.kind === 'derived_lifecycle'">Derived</Tag>
          <code v-else>#{{ item.sequence }} · {{ item.type }}</code>
          <small v-if="item.durationMs !== null">
            {{ formatDuration(item.durationMs) }}
          </small>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.run-timeline {
  display: grid;
  padding: 2px 0;
}

.run-timeline__row {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  padding-bottom: 8px;
}

.run-timeline__row:not(:last-child)::before {
  position: absolute;
  top: 24px;
  bottom: -4px;
  left: 13px;
  border-left: 1px solid var(--admin-border-strong);
  content: '';
}

.run-timeline__row.is-derived:not(:last-child)::before {
  border-left-style: dashed;
}

.run-timeline__marker {
  position: relative;
  z-index: 1;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--admin-border);
  border-radius: 50%;
  color: var(--admin-primary);
  background: var(--admin-surface);
  font-size: 12px;
}

.is-completed .run-timeline__marker {
  color: var(--admin-success-strong);
}

.is-failed .run-timeline__marker {
  color: #e5484d;
}

.is-aborted .run-timeline__marker {
  color: #d97706;
}

.is-running .run-timeline__marker {
  color: var(--admin-primary);
  box-shadow: 0 0 0 3px var(--admin-primary-soft);
}

.run-timeline__item {
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.run-timeline__item:hover {
  border-color: var(--admin-border);
  background: var(--admin-hover);
}

.run-timeline__item.is-selected {
  border-color: color-mix(in srgb, var(--admin-primary) 42%, var(--admin-border));
  background: var(--admin-primary-soft);
  box-shadow: inset 2px 0 var(--admin-primary);
}

.run-timeline__heading,
.run-timeline__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.run-timeline__heading strong {
  overflow: hidden;
  color: var(--admin-text);
  font-size: 12px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-timeline__heading time,
.run-timeline__meta small {
  flex: 0 0 auto;
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.run-timeline__meta code {
  min-width: 0;
  overflow: hidden;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-timeline__meta :deep(.ant-tag) {
  margin: 0;
  font-size: 9px;
  line-height: 17px;
}
</style>
