<script setup lang="ts">
import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'

import { App as AntApp, theme as antdTheme, ConfigProvider } from 'ant-design-vue'
import enUS from 'ant-design-vue/es/locale/en_US'
import zhCN from 'ant-design-vue/es/locale/zh_CN'

import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { useAdminPreferencesStore } from '@/stores/preferences'

const preferences = useAdminPreferencesStore()
const route = useRoute()
const { locale, t } = useI18n()

const antLocale = computed(() => locale.value === 'en-US' ? enUS : zhCN)

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

watch([() => route.meta.titleKey, locale], () => {
  const title = route.meta.titleKey ? t(route.meta.titleKey) : route.meta.title
  document.title = title ? `${title} · ${t('common.appName')}` : t('common.appName')
}, { immediate: true })
</script>

<template>
  <ConfigProvider :locale="antLocale" :theme="themeConfig">
    <AntApp>
      <RouterView />
    </AntApp>
  </ConfigProvider>
</template>
