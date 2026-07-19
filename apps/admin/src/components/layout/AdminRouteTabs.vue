<script setup lang="ts">
import type { RouteTab } from '@/lib/admin-state'
import { CloseOutlined } from '@ant-design/icons-vue'
import { ref, watch } from 'vue'

import { useRoute, useRouter } from 'vue-router'
import { routeAfterTabClose } from '@/lib/admin-state'

const route = useRoute()
const router = useRouter()
const tabs = ref<RouteTab[]>([
  { path: '/overview', title: 'Overview', fixed: true },
])

watch(() => route.path, () => {
  if (!route.meta.tab || tabs.value.some(tab => tab.path === route.path))
    return

  tabs.value.push({
    path: route.path,
    title: route.meta.title ?? route.path,
  })
}, { immediate: true })

async function closeTab(tab: RouteTab) {
  if (tab.fixed)
    return

  const nextPath = routeAfterTabClose(tabs.value, tab.path, route.path)
  tabs.value = tabs.value.filter(item => item.path !== tab.path)

  if (tab.path === route.path)
    await router.push(nextPath)
}
</script>

<template>
  <div class="route-tabs" aria-label="已访问页面">
    <div
      v-for="tab in tabs"
      :key="tab.path"
      class="route-tab"
      :class="{ 'is-active': route.path === tab.path }"
    >
      <button type="button" @click="router.push(tab.path)">
        {{ tab.title }}
      </button>
      <button
        v-if="!tab.fixed"
        class="route-tab__close"
        type="button"
        :aria-label="`关闭 ${tab.title}`"
        @click.stop="closeTab(tab)"
      >
        <CloseOutlined />
      </button>
    </div>
  </div>
</template>

<style scoped>
.route-tabs {
  position: sticky;
  z-index: 19;
  top: var(--admin-header-height);
  display: flex;
  height: var(--admin-tabs-height);
  align-items: end;
  gap: 3px;
  padding: 5px 12px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.route-tab {
  position: relative;
  display: flex;
  height: 32px;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 7px 7px 0 0;
  color: var(--admin-text-muted);
  background: transparent;
}

.route-tab:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.route-tab.is-active {
  border-color: var(--admin-border);
  border-bottom-color: var(--admin-bg-deep);
  color: var(--admin-primary);
  background: var(--admin-bg-deep);
}

.route-tab::before {
  position: absolute;
  right: 8px;
  bottom: -1px;
  left: 8px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: transparent;
  content: '';
}

.route-tab.is-active::before {
  background: var(--admin-primary);
}

.route-tab button {
  height: 100%;
  padding: 0 12px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.route-tab:has(.route-tab__close) > button:first-child {
  padding-right: 4px;
}

.route-tab .route-tab__close {
  width: 24px;
  padding: 0 8px 0 2px;
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.route-tab .route-tab__close:hover {
  color: var(--admin-text);
}
</style>
