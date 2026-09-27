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
    colorPrimary: '#135230', // 森林绿 tint
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#fcfcf9',
    colorBorderSecondary: '#ebebe8',
    colorText: '#1d1d1f',
    colorTextSecondary: '#6e6e73',
  },
  dark: {
    colorPrimary: '#4f9a6c',
    colorBgContainer: '#252528',
    colorBgElevated: '#2c2c2f',
    colorBgLayout: '#1e1e20',
    colorBorderSecondary: '#333336',
    colorText: '#f5f5f7',
    colorTextSecondary: '#a1a1a6',
  },
} as const

const themeConfig = computed<ThemeConfig>(() => {
  const dark = preferences.resolvedTheme === 'dark'
  const seeds = dark ? seedColors.dark : seedColors.light

  return {
    algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      ...seeds,
      colorError: dark ? '#e86156' : '#ba3630',
      colorWarning: dark ? '#ca933e' : '#a97416',
      colorSuccess: dark ? '#5aa877' : '#307a4f',
      colorInfo: seeds.colorPrimary,
      colorLink: seeds.colorPrimary,
      borderRadius: 8,
      fontFamily: 'var(--admin-font-family)',
      fontSize: 14,
    },
    components: {
      Button: {
        controlHeight: 32,
        borderRadius: 8,
        primaryColor: '#ffffff',
      },
      Card: {
        paddingLG: 20,
        borderRadiusLG: 12,
      },
      Menu: {
        itemBorderRadius: 8,
        itemHeight: 38,
        itemMarginBlock: 2,
        itemMarginInline: 8,
      },
      Segmented: {
        borderRadius: 999,
        borderRadiusSM: 999,
        borderRadiusXS: 999,
        bgColorSelected: dark ? '#3a3a3d' : '#ffffff',
      },
      Table: {
        tableHeaderBg: 'transparent',
        tableHeaderCellSplitColor: 'transparent',
        // 不透明：固定列悬停时要盖住下面滚过去的单元格
        tableRowHoverBg: dark ? '#262628' : '#f4f4f1',
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
