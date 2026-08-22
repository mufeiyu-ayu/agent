<script setup lang="ts">
import type { AdminDebugModelIOCapture } from '@agent/contracts'
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
  capture?: AdminDebugModelIOCapture | null
}>()

const { t } = useI18n()

const jsonData = computed<JsonDataType>(() => (
  props.capture && !props.capture.truncated ? props.capture.value : null
) as JsonDataType)

const copyText = computed(() => {
  if (!props.capture)
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
</script>

<template>
  <Alert
    v-if="!capture"
    type="info"
    show-icon
    :message="t('runTrace.inspector.debugCapture.empty')"
  />

  <div v-else class="debug-json-pane">
    <div class="debug-json-toolbar">
      <Alert
        v-if="capture.truncated"
        class="debug-json-truncated"
        type="warning"
        show-icon
        :message="t('runTrace.inspector.debugCapture.truncated')"
      />
      <Button size="small" @click="copyJson">
        {{ t('runTrace.inspector.debugCapture.copy') }}
      </Button>
    </div>

    <pre v-if="capture.truncated" class="debug-json-preview">{{ capture.preview }}</pre>
    <VueJsonPretty
      v-else
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

.debug-json-truncated {
  flex: 1;
}

.debug-json-preview,
.debug-json-tree {
  max-height: 60vh;
  overflow: auto;
  margin: 0;
  padding: 8px;
  border: 1px solid rgb(0 0 0 / 6%);
  border-radius: 6px;
  font-size: 12px;
}

.debug-json-preview {
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
