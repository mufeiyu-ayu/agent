<script setup lang="ts">
import type { AgentRunStatus, AgentStepStatus, MessageStatus } from '@agent/contracts'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  status: AgentRunStatus | AgentStepStatus | MessageStatus
}>()

const { t } = useI18n()

const tone = computed(() => ({
  ABORTED: 'neutral',
  COMPLETED: 'success',
  FAILED: 'danger',
  PENDING: 'neutral',
  RUNNING: 'active',
  STREAMING: 'active',
})[props.status])
</script>

<template>
  <span class="run-status" :class="`is-${tone}`" :title="status">
    <i />
    {{ t(`common.status.${status}`) }}
  </span>
</template>

<style scoped>
.run-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  white-space: nowrap;
}

.run-status i {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--admin-text-subtle);
}

.run-status.is-success {
  color: var(--admin-text);
}

.run-status.is-success i {
  background: var(--admin-success);
}

.run-status.is-danger {
  color: var(--admin-danger);
  font-weight: 500;
}

.run-status.is-danger i {
  background: var(--admin-danger);
}

.run-status.is-active {
  color: var(--admin-primary);
}

.run-status.is-active i {
  background: var(--admin-primary);
  box-shadow: 0 0 0 3px var(--admin-primary-soft);
  animation: status-pulse 1.2s ease-in-out infinite alternate;
}

@keyframes status-pulse {
  from { opacity: 0.45; }
  to { opacity: 1; }
}
</style>
