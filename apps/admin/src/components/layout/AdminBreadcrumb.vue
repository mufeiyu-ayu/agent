<script setup lang="ts">
import { Breadcrumb, BreadcrumbItem } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const route = useRoute()
const { t } = useI18n()
const currentTitle = computed(() => route.meta.titleKey
  ? t(route.meta.titleKey)
  : route.meta.title ?? t('navigation.overview'))
const parent = computed(() => route.meta.parentPath && (route.meta.parentTitleKey || route.meta.parentTitle)
  ? {
      path: route.meta.parentPath,
      title: route.meta.parentTitleKey ? t(route.meta.parentTitleKey) : route.meta.parentTitle,
    }
  : undefined)
</script>

<template>
  <Breadcrumb class="admin-breadcrumb">
    <BreadcrumbItem v-if="parent">
      <RouterLink :to="parent.path">
        {{ parent.title }}
      </RouterLink>
    </BreadcrumbItem>
    <BreadcrumbItem>{{ currentTitle }}</BreadcrumbItem>
  </Breadcrumb>
</template>

<style scoped>
.admin-breadcrumb {
  font-size: var(--admin-font-sm);
}
</style>
