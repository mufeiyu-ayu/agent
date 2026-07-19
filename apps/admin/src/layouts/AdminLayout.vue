<script setup lang="ts">
import { RouterView } from 'vue-router'

import AdminHeader from '@/components/layout/AdminHeader.vue'
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
      <AdminHeader />
      <AdminRouteTabs />
      <main class="admin-content">
        <RouterView />
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
</style>
