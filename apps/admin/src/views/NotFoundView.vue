<script setup lang="ts">
import { ArrowLeftOutlined } from '@ant-design/icons-vue'
import { Button, Result } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <main class="not-found">
    <Result
      status="404"
      title="404"
      :sub-title="t('notFound.description')"
    >
      <template #extra>
        <Button type="primary" @click="router.push('/overview')">
          <template #icon>
            <ArrowLeftOutlined />
          </template>
          {{ t('notFound.back') }}
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
