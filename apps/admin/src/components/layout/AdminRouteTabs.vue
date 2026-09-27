<script setup lang="ts">
import type { RouteTab } from '@/lib/admin-state'
import { CloseOutlined } from '@ant-design/icons-vue'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useRoute, useRouter } from 'vue-router'
import { resolveRouteTabTitle, routeAfterTabClose } from '@/lib/admin-state'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const tabs = ref<RouteTab[]>([
  { path: '/overview', title: 'Overview', fixed: true },
])

watch(() => route.path, () => {
  if (!route.meta.tab || tabs.value.some(tab => tab.path === route.path))
    return

  tabs.value.push({
    path: route.path,
    title: resolveRouteTabTitle(route),
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

function getTabTitle(tab: RouteTab): string {
  const resolved = router.resolve(tab.path)

  if (resolved.name === 'run-detail' || resolved.name === 'conversation-detail') {
    return resolveRouteTabTitle(resolved, (routeName, id) => t(
      routeName === 'run-detail' ? 'navigation.runTab' : 'navigation.conversationTab',
      { id },
    ))
  }

  return resolved.meta.titleKey ? t(resolved.meta.titleKey) : tab.title
}
</script>

<template>
  <div class="route-tabs" :aria-label="t('navigation.visited')">
    <div
      v-for="tab in tabs"
      :key="tab.path"
      class="route-tab"
      :class="{ 'is-active': route.path === tab.path }"
    >
      <button
        type="button"
        :aria-label="t('common.actions.open', { name: getTabTitle(tab) })"
        :title="getTabTitle(tab)"
        @click="router.push(tab.path)"
      >
        {{ getTabTitle(tab) }}
      </button>
      <button
        v-if="!tab.fixed"
        class="route-tab__close"
        type="button"
        :aria-label="t('common.actions.close', { name: getTabTitle(tab) })"
        :title="t('common.actions.close', { name: getTabTitle(tab) })"
        @click.stop="closeTab(tab)"
      >
        <CloseOutlined />
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 面板顶部的已访问页面：macOS 式胶囊，不再是浏览器标签页 */
.route-tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.route-tab {
  display: flex;
  height: 28px;
  flex: none;
  align-items: center;
  border-radius: 999px;
  color: var(--admin-text-muted);
}

.route-tab:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.route-tab.is-active {
  color: var(--admin-text);
  font-weight: 500;
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.route-tab button {
  height: 100%;
  padding: 0 12px;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--admin-font-sm);
}

.route-tab:has(.route-tab__close) > button:first-child {
  padding-right: 4px;
}

.route-tab .route-tab__close {
  width: 24px;
  padding: 0 8px 0 2px;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}

.route-tab .route-tab__close:hover {
  color: var(--admin-text);
}
</style>
