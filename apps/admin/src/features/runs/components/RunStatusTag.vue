<script setup lang="ts">
import type { RunMessageStatus, RunStatus, RunStepStatus } from '../run.model'
import { Tag } from 'ant-design-vue'
import { computed } from 'vue'

const props = defineProps<{
  status: RunStatus | RunStepStatus | RunMessageStatus
}>()

const color = computed(() => ({
  ABORTED: 'orange',
  COMPLETED: 'green',
  FAILED: 'red',
  PENDING: 'default',
  RUNNING: 'blue',
  STREAMING: 'cyan',
})[props.status])
</script>

<template>
  <Tag class="run-status-tag" :color="color">
    {{ status }}
  </Tag>
</template>

<style scoped>
.run-status-tag {
  min-width: 70px;
  margin-inline-end: 0;
  text-align: center;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.025em;
}
</style>
