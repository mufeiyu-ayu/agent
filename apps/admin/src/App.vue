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
    colorPrimary: '#0284c7', // 2024–2026 前沿云基础设施 Glacier Ice Cyan 冰川极光青（Neon DB / Railway 风格）
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f4f5f7',
    colorBorderSecondary: '#e5e7eb',
    colorText: '#1f2937',
    colorTextSecondary: '#6b7280',
  },
  dark: {
    colorPrimary: '#38bdf8', // 暗色模式高透光赛博电光青
    colorBgContainer: '#12161f',
    colorBgElevated: '#1a1f2c',
    colorBgLayout: '#0d1117',
    colorBorderSecondary: '#2d3342',
    colorText: '#f3f4f6',
    colorTextSecondary: '#9ca3af',
  },
} as const

const themeConfig = computed<ThemeConfig>(() => {
  const dark = preferences.resolvedTheme === 'dark'

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      ...(dark ? seedColors.dark : seedColors.light),
      borderRadius: 8,
      fontFamily: 'var(--admin-font-family)',
      fontSize: 14,
    },
    components: {
      Button: {
        controlHeight: 34,
        borderRadius: 8,
        primaryColor: '#ffffff',
      },
      Switch: {
        colorPrimary: dark ? '#38bdf8' : '#0284c7',
        colorPrimaryHover: dark ? '#7dd3fc' : '#0369a1',
      },
      Card: {
        paddingLG: 20,
      },
      Input: {
        borderRadius: 8,
        activeBorderColor: dark ? '#38bdf8' : '#0284c7',
        hoverBorderColor: dark ? '#0284c7' : '#38bdf8',
      },
      InputNumber: {
        borderRadius: 8,
        activeBorderColor: dark ? '#38bdf8' : '#0284c7',
        hoverBorderColor: dark ? '#0284c7' : '#38bdf8',
      },
      Select: {
        borderRadius: 8,
        colorPrimary: dark ? '#38bdf8' : '#0284c7',
        colorPrimaryHover: dark ? '#7dd3fc' : '#0369a1',
        activeBorderColor: dark ? '#38bdf8' : '#0284c7',
        hoverBorderColor: dark ? '#0284c7' : '#38bdf8',
      },
      Menu: {
        itemBorderRadius: 8,
        itemHeight: 38,
        itemMarginBlock: 2,
        itemMarginInline: 8,
      },
      Segmented: {
        borderRadius: 8,
        bgColorSelected: dark ? '#27272a' : '#ffffff',
      },
      Table: {
        tableHeaderBg: 'transparent',
        tableHeaderCellSplitColor: 'transparent',
        tableRowHoverBg: dark ? '#202432' : '#f5f7fa',
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
