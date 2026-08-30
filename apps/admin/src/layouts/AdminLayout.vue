<script setup lang="ts">
import { RouterView } from 'vue-router'

import AdminRouteTabs from '@/components/layout/AdminRouteTabs.vue'
import AdminSidebar from '@/components/layout/AdminSidebar.vue'
import { useAdminPreferencesStore } from '@/stores/preferences'

const preferences = useAdminPreferencesStore()
</script>

<template>
  <div
    class="admin-shell"
    :class="{ 'is-sidebar-collapsed': preferences.sidebarCollapsed }"
  >
    <AdminSidebar
      :collapsed="preferences.sidebarCollapsed"
      @toggle="preferences.toggleSidebar"
    />

    <section class="admin-main">
      <AdminRouteTabs />
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

.admin-main {
  min-height: 100vh;
  margin-left: var(--admin-sidebar-width);
  transition: margin-left 180ms ease;
}

.is-sidebar-collapsed .admin-main {
  margin-left: var(--admin-sidebar-collapsed-width);
}

.admin-content {
  min-height: calc(100vh - var(--admin-header-height) - var(--admin-tabs-height));
  padding: 20px;
  background: var(--admin-bg-deep);
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
