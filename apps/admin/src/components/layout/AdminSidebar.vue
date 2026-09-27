<script setup lang="ts">
import {
  ApiOutlined,
  CommentOutlined,
  DashboardOutlined,
  ProfileOutlined,
  TeamOutlined,
} from '@ant-design/icons-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { resolveActiveMenuPath } from '@/lib/admin-state'
import AdminLogo from './AdminLogo.vue'

defineProps<{
  collapsed: boolean
}>()

const sections = [
  {
    labelKey: 'navigation.workspace',
    items: [
      { path: '/overview', labelKey: 'navigation.overview', icon: DashboardOutlined },
      { path: '/conversations', labelKey: 'navigation.conversations', icon: CommentOutlined },
      { path: '/runs', labelKey: 'navigation.runs', icon: ProfileOutlined },
    ],
  },
  {
    labelKey: 'navigation.system',
    items: [
      { path: '/llm-models', labelKey: 'navigation.llmModels', icon: ApiOutlined },
      { path: '/users', labelKey: 'navigation.users', icon: TeamOutlined },
    ],
  },
]

const route = useRoute()
const { t } = useI18n()
const activeMenuPath = computed(() => resolveActiveMenuPath(route))
</script>

<template>
  <aside
    class="admin-sidebar"
    :class="{ 'is-collapsed': collapsed }"
    :aria-label="t('navigation.main')"
  >
    <AdminLogo :collapsed="collapsed" />

    <nav class="admin-nav">
      <template v-for="section in sections" :key="section.labelKey">
        <span v-if="!collapsed" class="admin-nav__section">{{ t(section.labelKey) }}</span>
        <RouterLink
          v-for="item in section.items"
          :key="item.path"
          :to="item.path"
          class="admin-nav__item"
          :class="{ 'is-active': activeMenuPath === item.path }"
          :aria-current="activeMenuPath === item.path ? 'page' : undefined"
          :aria-label="collapsed ? t(item.labelKey) : undefined"
          :title="collapsed ? t(item.labelKey) : undefined"
        >
          <component :is="item.icon" class="admin-nav__icon" />
          <span v-if="!collapsed">{{ t(item.labelKey) }}</span>
        </RouterLink>
      </template>
    </nav>
  </aside>
</template>

<style scoped>
/* 侧栏直接坐在画布上：无底板、无边框，选中项是白色小胶囊 */
.admin-sidebar {
  position: fixed;
  z-index: 30;
  inset: 0 auto 0 0;
  display: flex;
  width: var(--admin-sidebar-width);
  flex-direction: column;
  overflow: hidden;
  padding: 16px 12px 12px 14px;
  transition: width 180ms ease;
}

.admin-sidebar.is-collapsed {
  width: var(--admin-sidebar-collapsed-width);
  padding-inline: 12px;
}

.admin-nav {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.admin-nav__section {
  padding: 18px 12px 8px;
  color: var(--admin-text-muted);
  font-size: 12.5px;
  font-weight: 600;
}

.admin-nav__section:first-child {
  padding-top: 0;
}

.admin-nav__item {
  display: flex;
  height: 40px;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-radius: var(--admin-radius-md);
  color: var(--admin-text);
  font-size: 15px;
  text-decoration: none;
  transition: background-color 140ms ease, color 140ms ease;
}

.admin-nav__item:hover {
  background: var(--admin-hover);
}

.admin-nav__item.is-active {
  color: var(--admin-primary);
  font-weight: 600;
  background: var(--admin-surface);
  box-shadow: 0 0 0 0.5px rgb(40 70 50 / 10%), 0 1px 2px rgb(30 60 40 / 10%);
}

.admin-nav__icon {
  flex: 0 0 20px;
  color: var(--admin-text-muted);
  font-size: 18px;
}

.admin-nav__item.is-active .admin-nav__icon {
  color: var(--admin-primary);
}

.is-collapsed .admin-nav__item {
  justify-content: center;
  padding: 0;
}
</style>
