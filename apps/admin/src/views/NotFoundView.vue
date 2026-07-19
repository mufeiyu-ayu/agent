<script setup lang="ts">
import { ArrowLeftOutlined } from '@ant-design/icons-vue'
import { Button, Result } from 'ant-design-vue'
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <main class="not-found">
    <Result
      status="404"
      title="404"
      sub-title="你访问的页面不存在，或尚未纳入 Agent Console。"
    >
      <template #extra>
        <Button type="primary" @click="router.push('/overview')">
          <template #icon>
            <ArrowLeftOutlined />
          </template>
          返回 Overview
        </Button>
      </template>
    </Result>
  </main>
</template>

<style scoped>
.not-found {
  display: grid;
  min-height: 100vh;
  place-items: center;
  background: var(--admin-bg-deep);
}
</style>
