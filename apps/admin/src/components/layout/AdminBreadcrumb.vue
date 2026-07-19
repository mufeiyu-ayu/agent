<script setup lang="ts">
import { HomeOutlined } from '@ant-design/icons-vue'
import { Breadcrumb, BreadcrumbItem } from 'ant-design-vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const currentTitle = computed(() => route.meta.title ?? 'Overview')
</script>

<template>
  <Breadcrumb class="admin-breadcrumb">
    <BreadcrumbItem>
      <RouterLink to="/overview" aria-label="Overview">
        <HomeOutlined />
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
