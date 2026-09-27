<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  collapsed: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <RouterLink class="admin-logo" to="/overview" :aria-label="t('navigation.backToOverview')">
    <span class="admin-logo__mark" aria-hidden="true">
      <svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round">
        <circle cx="9" cy="9" r="5.2" />
        <circle cx="13.2" cy="4.8" r="1.8" fill="#fff" stroke="none" />
      </svg>
    </span>
    <strong v-if="!collapsed" class="admin-logo__name">{{ t('common.appName') }}</strong>
  </RouterLink>
</template>

<style scoped>
.admin-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 10px 20px;
  color: var(--admin-text);
  text-decoration: none;
}

.admin-logo__mark {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border-radius: 9px;
  background: linear-gradient(180deg, #296944, #0f4a2a);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 35%), 0 1px 2px rgb(0 0 0 / 18%);
}

.admin-logo__mark svg {
  width: 21px;
  height: 21px;
}

.admin-logo__name {
  overflow: hidden;
  font-size: var(--admin-font-lg);
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
</style>
