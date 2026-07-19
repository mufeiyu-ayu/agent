<script setup lang="ts">
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

import { App as AntApp, theme as antdTheme, ConfigProvider } from 'ant-design-vue'

import { computed } from 'vue'

import { useAdminPreferencesStore } from '@/stores/preferences'

const preferences = useAdminPreferencesStore()

const themeConfig = computed<ThemeConfig>(() => ({
  algorithm: preferences.resolvedTheme === 'dark'
    ? antdTheme.darkAlgorithm
    : antdTheme.defaultAlgorithm,
  token: {
    borderRadius: 8,
    colorPrimary: '#006fe6',
    fontFamily: 'var(--admin-font-family)',
  },
  components: {
    Button: {
      controlHeight: 34,
    },
    Card: {
      paddingLG: 20,
    },
    Menu: {
      itemBorderRadius: 8,
      itemHeight: 38,
      itemMarginBlock: 2,
      itemMarginInline: 8,
    },
  },
}))
</script>

<template>
  <ConfigProvider :theme="themeConfig">
    <AntApp>
      <RouterView />
    </AntApp>
  </ConfigProvider>
</template>
