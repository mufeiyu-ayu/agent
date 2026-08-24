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

/**
 * ant-design-vue 的 token 需要真实色值参与派生计算，无法直接消费 CSS 变量，
 * 因此这里镜像 styles/index.css 的关键色。改动其一必须同步另一处。
 */
const seedColors = {
  light: {
    colorPrimary: '#1c6ced',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f7f9',
    colorBorderSecondary: '#e7e9ee',
    colorText: '#282c34',
    colorTextSecondary: '#6b7280',
  },
  dark: {
    colorPrimary: '#518ff6',
    colorBgContainer: '#1c1e24',
    colorBgElevated: '#232630',
    colorBgLayout: '#111317',
    colorBorderSecondary: '#34363d',
    colorText: '#f0f2f4',
    colorTextSecondary: '#a4a9b4',
  },
} as const

const themeConfig = computed<ThemeConfig>(() => {
  const dark = preferences.resolvedTheme === 'dark'

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      ...(dark ? seedColors.dark : seedColors.light),
      borderRadius: 10,
      fontFamily: 'var(--admin-font-family)',
      fontSize: 14,
    },
    components: {
      Button: {
        controlHeight: 34,
        borderRadius: 8,
      },
      Card: {
        paddingLG: 20,
      },
      Input: {
        borderRadius: 8,
      },
      Select: {
        borderRadius: 8,
      },
      Menu: {
        itemBorderRadius: 8,
        itemHeight: 38,
        itemMarginBlock: 2,
        itemMarginInline: 8,
      },
      Segmented: {
        borderRadius: 8,
        bgColorSelected: dark ? '#2b2f3a' : '#ffffff',
      },
      Table: {
        tableHeaderBg: 'transparent',
        tableHeaderCellSplitColor: 'transparent',
        tableRowHoverBg: dark ? '#22252d' : '#f5f7fa',
      },
    },
  }
})

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
