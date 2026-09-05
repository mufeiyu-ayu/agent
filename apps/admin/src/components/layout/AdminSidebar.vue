<script setup lang="ts">
import {
  CommentOutlined,
  DashboardOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ProfileOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons-vue'
import { Popover } from 'ant-design-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { resolveActiveMenuPath } from '@/lib/admin-state'
import AdminLogo from './AdminLogo.vue'
import LanguageSwitcher from './LanguageSwitcher.vue'
import ThemeToggle from './ThemeToggle.vue'

defineProps<{
  collapsed: boolean
}>()

defineEmits<{
  toggle: []
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
]

const route = useRoute()
const { t } = useI18n()
const activeMenuPath = computed(() => resolveActiveMenuPath(route))
const quickActionsOpen = ref(false)
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

    <Popover
      v-model:open="quickActionsOpen"
      placement="rightBottom"
      :trigger="['click']"
      :overlay-inner-style="{ padding: 0 }"
    >
      <button
        class="admin-sidebar__actions-trigger"
        type="button"
        aria-haspopup="dialog"
        :aria-expanded="quickActionsOpen"
        :aria-label="t('navigation.quickActions')"
        :title="collapsed ? t('navigation.quickActions') : undefined"
      >
        <SettingOutlined />
        <span v-if="!collapsed">{{ t('navigation.quickActions') }}</span>
      </button>

      <template #content>
        <section class="admin-quick-actions" :aria-label="t('navigation.quickActions')">
          <div class="admin-quick-actions__user">
            <span class="admin-quick-actions__avatar">
              <UserOutlined />
            </span>
            <span>
              <strong>{{ t('common.developer') }}</strong>
              <small>{{ t('common.consoleUser') }}</small>
            </span>
          </div>

          <div class="admin-quick-actions__toolbar">
            <span class="admin-quick-actions__environment">
              <i />
              {{ t('common.local') }}
            </span>
            <div class="admin-quick-actions__controls">
              <LanguageSwitcher />
              <ThemeToggle />
            </div>
          </div>
        </section>
      </template>
    </Popover>

    <button
      class="admin-sidebar__toggle"
      type="button"
      :aria-label="t(collapsed ? 'navigation.expandSidebar' : 'navigation.collapseSidebar')"
      @click="$emit('toggle')"
    >
      <MenuUnfoldOutlined v-if="collapsed" />
      <MenuFoldOutlined v-else />
      <span v-if="!collapsed">{{ t('navigation.collapseMenu') }}</span>
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
  font-size: var(--admin-font-2xs);
  font-weight: 650;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.admin-nav__section:not(:first-child) {
  margin-top: 14px;
}

.admin-nav__item {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 11px;
  padding: 0 12px;
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-md);
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
  font-size: var(--admin-font-lg);
}

.is-collapsed .admin-nav__item {
  justify-content: center;
  padding: 0;
}

.admin-sidebar__actions-trigger,
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
  font-size: var(--admin-font-sm);
}

.admin-sidebar__actions-trigger {
  margin-bottom: 4px;
  color: var(--admin-text-muted);
  background: transparent;
}

.admin-sidebar__actions-trigger:hover,
.admin-sidebar__actions-trigger[aria-expanded='true'] {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.admin-sidebar__actions-trigger :deep(.anticon),
.admin-sidebar__toggle :deep(.anticon) {
  flex: 0 0 16px;
  font-size: var(--admin-font-lg);
}

.admin-sidebar__toggle {
  margin-top: 0;
}

.admin-sidebar__toggle:hover {
  color: var(--admin-text);
}

.is-collapsed .admin-sidebar__actions-trigger,
.is-collapsed .admin-sidebar__toggle {
  justify-content: center;
  margin-inline: 12px;
  padding: 0;
}

.admin-quick-actions {
  width: 220px;
  color: var(--admin-text);
}

.admin-quick-actions__user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--admin-border);
}

.admin-quick-actions__avatar {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border-radius: 50%;
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
  font-size: var(--admin-font-md);
}

.admin-quick-actions__user > span:last-child {
  display: grid;
  line-height: 1.1;
}

.admin-quick-actions__user strong {
  font-size: var(--admin-font-sm);
  font-weight: 600;
}

.admin-quick-actions__user small {
  margin-top: 4px;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}

.admin-quick-actions__toolbar {
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
}

.admin-quick-actions__environment {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.admin-quick-actions__environment i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--admin-success);
  box-shadow: 0 0 0 3px var(--admin-success-soft);
}

.admin-quick-actions__controls {
  display: flex;
  align-items: center;
}
</style>
