<script setup lang="ts">
import type { AdminLocale } from '@/i18n'
import { GlobalOutlined } from '@ant-design/icons-vue'
import { Button, Tooltip } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { localeOptions, persistAdminLocale, syncDocumentLocale } from '@/i18n'

const { locale, t } = useI18n()
const currentOption = computed(() => (
  localeOptions.find(option => option.value === locale.value) ?? localeOptions[0]
))
const nextOption = computed(() => (
  localeOptions.find(option => option.value !== locale.value) ?? localeOptions[0]
))
const switchLabel = computed(() => t('language.switcher', {
  language: t(nextOption.value.labelKey),
}))

function selectLocale(value: AdminLocale): void {
  locale.value = value
  persistAdminLocale(value)
  syncDocumentLocale(value)
}
</script>

<template>
  <Tooltip :title="switchLabel">
    <Button
      class="language-trigger"
      type="text"
      :aria-label="switchLabel"
      @click="selectLocale(nextOption.value)"
    >
      <GlobalOutlined />
      <span>{{ currentOption.shortLabel }}</span>
    </Button>
  </Tooltip>
</template>

<style scoped>
.language-trigger {
  display: flex;
  min-width: 56px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--admin-text-muted);
  font-size: 13px;
}

.language-trigger span {
  font-size: 11px;
  font-weight: 600;
}
</style>
