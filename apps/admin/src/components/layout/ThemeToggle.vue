<script setup lang="ts">
import type { AdminTheme } from '@/lib/admin-state'
import {
  BulbOutlined,
  DesktopOutlined,
  HighlightOutlined,
} from '@ant-design/icons-vue'
import { Button, Dropdown, Tooltip } from 'ant-design-vue'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAdminPreferencesStore } from '@/stores/preferences'

const preferences = useAdminPreferencesStore()
const { t } = useI18n()
const menuOpen = ref(false)

const currentLabel = computed(() => ({
  dark: t('theme.dark'),
  light: t('theme.light'),
  system: t('theme.system'),
})[preferences.theme])

const currentIcon = computed(() => ({
  dark: HighlightOutlined,
  light: BulbOutlined,
  system: DesktopOutlined,
})[preferences.theme])

function selectTheme(value: AdminTheme) {
  preferences.setTheme(value)
  menuOpen.value = false
}
</script>

<template>
  <Dropdown v-model:open="menuOpen" placement="bottomRight" :trigger="['click']">
    <Tooltip :title="currentLabel">
      <Button class="theme-trigger" type="text" :aria-label="currentLabel">
        <component :is="currentIcon" />
      </Button>
    </Tooltip>

    <template #overlay>
      <div class="theme-menu" role="menu" :aria-label="t('theme.menu')">
        <button
          type="button"
          role="menuitemradio"
          :aria-checked="preferences.theme === 'light'"
          @click="selectTheme('light')"
        >
          <BulbOutlined />
          <span>{{ t('theme.light') }}</span>
        </button>
        <button
          type="button"
          role="menuitemradio"
          :aria-checked="preferences.theme === 'dark'"
          @click="selectTheme('dark')"
        >
          <HighlightOutlined />
          <span>{{ t('theme.dark') }}</span>
        </button>
        <button
          type="button"
          role="menuitemradio"
          :aria-checked="preferences.theme === 'system'"
          @click="selectTheme('system')"
        >
          <DesktopOutlined />
          <span>{{ t('theme.system') }}</span>
        </button>
      </div>
    </template>
  </Dropdown>
</template>

<style scoped>
.theme-trigger {
  display: grid;
  width: 34px;
  place-items: center;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-lg);
}

.theme-menu {
  display: grid;
  min-width: 136px;
  padding: 5px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: var(--admin-surface);
  box-shadow: 0 8px 28px rgb(15 23 42 / 12%);
}

.theme-menu button {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  color: var(--admin-text-muted);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--admin-font-xs);
  text-align: left;
}

.theme-menu button:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.theme-menu button[aria-checked='true'] {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}
</style>
