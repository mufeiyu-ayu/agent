<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { getDemoMessage, type DemoResponse } from './api/demo'

const demo = ref<DemoResponse | null>(null)
const loading = ref(false)
const errorMessage = ref('')

async function loadDemoMessage() {
  loading.value = true
  errorMessage.value = ''

  try {
    demo.value = await getDemoMessage()
  }
  catch (error) {
    errorMessage.value = error instanceof Error
      ? error.message
      : '请求示例接口失败'
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadDemoMessage()
})
</script>

<template>
  <main class="page">
    <section class="panel">
      <p class="eyebrow">
        AI SEO Agent
      </p>
      <h1>Vue 前端联调 Nest 示例接口</h1>
      <p class="description">
        当前页面通过 axios 请求 <code>GET /api/demo</code>，Vite 开发代理会转发到 Nest 服务。
      </p>

      <button type="button" :disabled="loading" @click="loadDemoMessage">
        {{ loading ? '请求中...' : '重新请求示例接口' }}
      </button>

      <div v-if="errorMessage" class="result error">
        {{ errorMessage }}
      </div>

      <div v-else class="result">
        <p>
          <span>message</span>
          <strong>{{ demo?.message ?? '等待接口返回' }}</strong>
        </p>
        <p>
          <span>timestamp</span>
          <strong>{{ demo?.timestamp ?? '-' }}</strong>
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  color: #172033;
  background: #f5f7fb;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

.page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
}

.panel {
  width: min(100%, 680px);
  padding: 32px;
  background: #ffffff;
  border: 1px solid #dde4f0;
  border-radius: 8px;
  box-shadow: 0 24px 60px rgb(20 35 65 / 10%);
}

.eyebrow {
  margin: 0 0 10px;
  color: #315bb8;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.25;
}

.description {
  margin: 14px 0 24px;
  color: #4b5870;
  line-height: 1.7;
}

code {
  padding: 2px 6px;
  color: #1c3f8f;
  background: #edf3ff;
  border-radius: 4px;
  font-size: 0.92em;
}

button {
  min-height: 42px;
  padding: 0 18px;
  color: #ffffff;
  background: #1f6feb;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.result {
  display: grid;
  gap: 12px;
  margin-top: 24px;
  padding: 18px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.result p {
  display: grid;
  gap: 6px;
  margin: 0;
}

.result span {
  color: #64748b;
  font-size: 13px;
}

.result strong {
  overflow-wrap: anywhere;
  font-size: 16px;
}

.error {
  color: #9f1239;
  background: #fff1f2;
  border-color: #fecdd3;
}
</style>
