<script setup lang="ts">
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons-vue'
import { Button } from 'ant-design-vue'

import { useAdminPreferencesStore } from '@/stores/preferences'

import AdminBreadcrumb from './AdminBreadcrumb.vue'
import ThemeToggle from './ThemeToggle.vue'

const preferences = useAdminPreferencesStore()
</script>

<template>
  <header class="admin-header">
    <div class="admin-header__start">
      <Button
        class="admin-header__sidebar-toggle"
        type="text"
        :aria-label="preferences.sidebarCollapsed ? '展开 Sidebar' : '折叠 Sidebar'"
        :title="preferences.sidebarCollapsed ? '展开 Sidebar' : '折叠 Sidebar'"
        @click="preferences.toggleSidebar"
      >
        <MenuUnfoldOutlined v-if="preferences.sidebarCollapsed" />
        <MenuFoldOutlined v-else />
      </Button>
      <AdminBreadcrumb />
    </div>

    <div class="admin-header__actions">
      <span class="admin-header__environment">
        <i />
        Local
      </span>
      <ThemeToggle />
      <div class="admin-header__user" aria-label="当前用户：Developer">
        <span class="admin-header__avatar">
          <UserOutlined />
        </span>
        <span>
          <strong>Developer</strong>
          <small>Console user</small>
        </span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.admin-header {
  position: sticky;
  z-index: 20;
  top: 0;
  display: flex;
  height: var(--admin-header-height);
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid var(--admin-border);
  background: color-mix(in srgb, var(--admin-surface) 94%, transparent);
  backdrop-filter: blur(10px);
}

.admin-header__actions,
.admin-header__start,
.admin-header__user {
  display: flex;
  align-items: center;
}

.admin-header__start {
  min-width: 0;
  gap: 4px;
}

.admin-header__sidebar-toggle {
  display: grid;
  width: 34px;
  place-items: center;
  color: var(--admin-text-muted);
  font-size: 16px;
}

.admin-header__actions {
  gap: 8px;
}

.admin-header__environment {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--admin-border);
  border-radius: 999px;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.admin-header__environment i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--admin-success);
  box-shadow: 0 0 0 3px var(--admin-success-soft);
}

.admin-header__user {
  gap: 9px;
  padding: 3px 5px;
  border-radius: 8px;
}

.admin-header__avatar {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--admin-primary) 18%, var(--admin-border));
  border-radius: 50%;
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
  font-size: 14px;
}

.admin-header__user > span {
  display: grid;
  line-height: 1.1;
}

.admin-header__user strong {
  color: var(--admin-text);
  font-size: 12px;
  font-weight: 600;
}

.admin-header__user small {
  margin-top: 3px;
  color: var(--admin-text-subtle);
  font-size: 10px;
}
</style>
