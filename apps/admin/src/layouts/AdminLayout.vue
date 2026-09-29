<script setup lang="ts">
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons-vue'
import { Button, Tooltip } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { RouterView } from 'vue-router'

import AdminRouteTabs from '@/components/layout/AdminRouteTabs.vue'
import AdminSidebar from '@/components/layout/AdminSidebar.vue'
import AdminUserMenu from '@/components/layout/AdminUserMenu.vue'
import ThemeToggle from '@/components/layout/ThemeToggle.vue'
import { useAdminPreferencesStore } from '@/stores/preferences'

const preferences = useAdminPreferencesStore()
const { t } = useI18n()
</script>

<template>
  <div
    class="admin-shell"
    :class="{ 'is-sidebar-collapsed': preferences.sidebarCollapsed }"
  >
    <AdminSidebar :collapsed="preferences.sidebarCollapsed" />

    <section class="admin-main">
      <header class="admin-topbar">
        <Tooltip :title="t(preferences.sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')">
          <Button
            type="text"
            class="admin-topbar__icon"
            :aria-label="t(preferences.sidebarCollapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')"
            @click="preferences.toggleSidebar"
          >
            <MenuUnfoldOutlined v-if="preferences.sidebarCollapsed" />
            <MenuFoldOutlined v-else />
          </Button>
        </Tooltip>
        <AdminRouteTabs />
        <div class="admin-topbar__actions">
          <ThemeToggle />
          <AdminUserMenu />
        </div>
      </header>
      <main class="admin-content">
        <RouterView v-slot="{ Component }">
          <Transition name="route-slide" mode="out-in">
            <component :is="Component" :key="$route.path" />
          </Transition>
        </RouterView>
      </main>
    </section>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
}

/* 内容面板：浮在画布上的近白大圆角面板 */
.admin-main {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--admin-shell-gap) * 2);
  margin: var(--admin-shell-gap) var(--admin-shell-gap) var(--admin-shell-gap) var(--admin-sidebar-width);
  overflow: clip;
  border-radius: var(--admin-radius-lg);
  background: var(--admin-bg-deep);
  box-shadow: var(--admin-shadow-panel);
  transition: margin-left 180ms ease;
}

.is-sidebar-collapsed .admin-main {
  margin-left: var(--admin-sidebar-collapsed-width);
}

/* 顶栏：收起侧栏 / 已访问页面 / 主题、语言与账号 */
.admin-topbar {
  position: sticky;
  z-index: 19;
  top: 0;
  display: flex;
  height: var(--admin-tabs-height);
  align-items: center;
  gap: 8px;
  padding: 0 12px 0 10px;
  border-bottom: 0.5px solid var(--admin-border-strong);
  background: color-mix(in srgb, var(--admin-bg-deep) 85%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
}

.admin-topbar__icon {
  display: grid;
  width: 32px;
  flex: none;
  place-items: center;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-lg);
}

.admin-topbar__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

/* 列表页的表格要撑满面板、分页栏贴底，所以内容区一路 flex 到底 */
.admin-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  padding: 20px 24px 0;
}

/* 路由切换：新页面从右滑入、旧页面向左滑出；prefers-reduced-motion 时由全局样式压到 0.01ms */
.route-slide-enter-active {
  transition: opacity 200ms ease, transform 200ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.route-slide-leave-active {
  transition: opacity 150ms ease, transform 150ms cubic-bezier(0.55, 0.06, 0.68, 0.19);
}

.route-slide-enter-from {
  opacity: 0;
  transform: translateX(32px);
}

.route-slide-leave-to {
  opacity: 0;
  transform: translateX(-32px);
}
</style>
