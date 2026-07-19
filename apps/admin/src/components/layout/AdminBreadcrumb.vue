<script setup lang="ts">
import { HomeOutlined } from '@ant-design/icons-vue'
import { Breadcrumb, BreadcrumbItem } from 'ant-design-vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const currentTitle = computed(() => route.meta.title ?? 'Overview')
const parent = computed(() => route.meta.parentPath && route.meta.parentTitle
  ? { path: route.meta.parentPath, title: route.meta.parentTitle }
  : undefined)
</script>

<template>
  <Breadcrumb class="admin-breadcrumb">
    <BreadcrumbItem>
      <RouterLink to="/overview" aria-label="Overview">
        <HomeOutlined />
      </RouterLink>
    </BreadcrumbItem>
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
  font-size: 13px;
}
</style>
