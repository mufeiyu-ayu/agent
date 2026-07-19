<script setup lang="ts">
import {
  DashboardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
} from '@ant-design/icons-vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { resolveActiveMenuPath } from '@/lib/admin-state'
import AdminLogo from './AdminLogo.vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
}>()

const navigation = [
  { path: '/overview', label: 'Overview', icon: DashboardOutlined },
  { path: '/runs', label: 'Runs', icon: ProfileOutlined },
]

const route = useRoute()
const activeMenuPath = computed(() => resolveActiveMenuPath(route))
</script>

<template>
  <aside
    class="admin-sidebar"
    :class="{ 'is-collapsed': collapsed }"
    aria-label="后台主导航"
  >
    <AdminLogo :collapsed="collapsed" />

    <nav class="admin-nav">
      <span v-if="!collapsed" class="admin-nav__section">Workspace</span>
      <RouterLink
        v-for="item in navigation"
        :key="item.path"
        :to="item.path"
        class="admin-nav__item"
        :class="{ 'is-active': activeMenuPath === item.path }"
        :aria-current="activeMenuPath === item.path ? 'page' : undefined"
        :aria-label="collapsed ? item.label : undefined"
        :title="collapsed ? item.label : undefined"
      >
        <component :is="item.icon" class="admin-nav__icon" />
        <span v-if="!collapsed">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <button
      class="admin-sidebar__toggle"
      type="button"
      :aria-label="collapsed ? '展开 Sidebar' : '折叠 Sidebar'"
      @click="$emit('toggle')"
    >
      <MenuUnfoldOutlined v-if="collapsed" />
      <MenuFoldOutlined v-else />
      <span v-if="!collapsed">收起菜单</span>
    </button>
  </aside>
</template>

<style scoped>
.admin-sidebar {
  position: fixed;
  z-index: 30;
  inset: 0 auto 0 0;
  display: flex;
  width: var(--admin-sidebar-width);
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: 2px 0 8px rgb(15 23 42 / 2%);
  transition: width 180ms ease;
}

.admin-sidebar.is-collapsed {
  width: var(--admin-sidebar-collapsed-width);
}

.admin-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
}

.admin-nav__section {
  padding: 4px 10px 8px;
  color: var(--admin-text-subtle);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.admin-nav__item {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 11px;
  padding: 0 12px;
  border-radius: var(--admin-radius);
  color: var(--admin-text-muted);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  transition: color 140ms ease, background-color 140ms ease;
}

.admin-nav__item:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.admin-nav__item.is-active {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.admin-nav__icon {
  width: 16px;
  flex: 0 0 16px;
  font-size: 16px;
}

.is-collapsed .admin-nav__item {
  justify-content: center;
  padding: 0;
}

.admin-sidebar__toggle {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 10px;
  margin: 0 12px 10px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: var(--admin-text-muted);
  background: var(--admin-hover);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}

.admin-sidebar__toggle:hover {
  color: var(--admin-text);
}

.is-collapsed .admin-sidebar__toggle {
  justify-content: center;
  margin-inline: 12px;
  padding: 0;
}
</style>
