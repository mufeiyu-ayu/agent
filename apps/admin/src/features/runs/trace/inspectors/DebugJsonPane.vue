<script setup lang="ts">
import type {
  AdminDebugModelIOCapture,
  AdminDebugModelResponseCapture,
} from '@agent/contracts'
import { Alert, Button, message } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import VueJsonPretty from 'vue-json-pretty'

import 'vue-json-pretty/lib/styles.css'

// vue-json-pretty 的 data prop 类型；捕获值来自后端 JSON 列，运行时必然满足。
type JsonDataType
  = | string
    | number
    | boolean
    | unknown[]
    | Record<string, unknown>
    | null

// 旧 API 构建返回的 run 数据没有 debug 字段（undefined 而非 null），一并按未捕获处理。
const props = defineProps<{
  capture?: AdminDebugModelIOCapture | AdminDebugModelResponseCapture | null
  responseCapture?: boolean
}>()

const { t } = useI18n()

const responseState = computed(() => (
  props.responseCapture && isResponseCapture(props.capture)
    ? props.capture.state
    : null
))

const jsonData = computed<JsonDataType>(() => {
  const capture = props.capture

  return (
    capture
    && !isEmptyResponseCapture(capture)
    && !capture.truncated
      ? capture.value
      : null
  ) as JsonDataType
})

const copyText = computed(() => {
  if (!props.capture)
    return ''

  if (props.responseCapture && isResponseCapture(props.capture)) {
    if (props.capture.state === 'empty')
      return JSON.stringify({ state: 'empty' }, null, 2)

    return JSON.stringify({
      state: props.capture.state,
      ...(props.capture.truncated
        ? { truncated: true, preview: props.capture.preview }
        : { response: props.capture.value }),
    }, null, 2)
  }

  if (isEmptyResponseCapture(props.capture))
    return ''

  return props.capture.truncated
    ? props.capture.preview
    : JSON.stringify(props.capture.value, null, 2)
})

// 大 JSON 用虚拟滚动，避免一次渲染全部节点；小 JSON 保持自然高度。
const useVirtual = computed(() => copyText.value.length > 50_000)

async function copyJson() {
  try {
    await navigator.clipboard.writeText(copyText.value)
    message.success(t('runTrace.inspector.debugCapture.copied'))
  }
  catch {
    message.error(t('runTrace.inspector.debugCapture.copyFailed'))
  }
}

function isResponseCapture(
  capture: AdminDebugModelIOCapture | AdminDebugModelResponseCapture | null | undefined,
): capture is AdminDebugModelResponseCapture {
  return capture !== null && capture !== undefined && 'state' in capture
}

function isEmptyResponseCapture(
  capture: AdminDebugModelIOCapture | AdminDebugModelResponseCapture,
): capture is Extract<AdminDebugModelResponseCapture, { state: 'empty' }> {
  return isResponseCapture(capture) && capture.state === 'empty'
}
</script>

<template>
  <Alert
    v-if="!capture"
    type="info"
    show-icon
    :message="t('runTrace.inspector.debugCapture.notCaptured')"
  />

  <div v-else class="debug-json-pane">
    <div class="debug-json-toolbar">
      <Alert
        v-if="responseState === 'partial'"
        class="debug-json-status"
        type="warning"
        show-icon
        :message="t('runTrace.inspector.debugCapture.partial')"
      />
      <Alert
        v-if="responseState === 'empty'"
        class="debug-json-status"
        type="info"
        show-icon
        :message="t('runTrace.inspector.debugCapture.emptyResponse')"
      />
      <Alert
        v-if="!isEmptyResponseCapture(capture) && capture.truncated"
        class="debug-json-status"
        type="warning"
        show-icon
        :message="t('runTrace.inspector.debugCapture.truncated')"
      />
      <Button size="small" @click="copyJson">
        {{ t('runTrace.inspector.debugCapture.copy') }}
      </Button>
    </div>

    <pre
      v-if="!isEmptyResponseCapture(capture) && capture.truncated"
      class="debug-json-preview"
    >{{ capture.preview }}</pre>
    <VueJsonPretty
      v-else-if="responseState !== 'empty'"
      class="debug-json-tree"
      :data="jsonData"
      :deep="4"
      :virtual="useVirtual"
      :height="480"
      show-length
      show-icon
    />
  </div>
</template>

<style scoped>
.debug-json-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.debug-json-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.debug-json-status {
  flex: 1;
}

.debug-json-preview,
.debug-json-tree {
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 12px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface-raised);
  box-shadow: var(--admin-shadow-sm);
  font-size: var(--admin-font-xs);
}

.debug-json-preview {
  white-space: pre-wrap;
  word-break: break-all;
}

/* 库默认写死浅蓝 #e6f7ff，暗色主题下刺眼且文字不可读，改用主题变量 */
.debug-json-tree :deep(.vjs-tree-node:hover),
.debug-json-tree :deep(.vjs-tree-node.is-highlight),
.debug-json-tree :deep(.vjs-tree-node .vjs-tree-node-actions) {
  background-color: var(--admin-hover);
}
</style>
