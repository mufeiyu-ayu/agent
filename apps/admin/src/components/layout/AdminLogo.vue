<script setup lang="ts">
import { CodeOutlined } from '@ant-design/icons-vue'

defineProps<{
  collapsed: boolean
}>()
</script>

<template>
  <RouterLink class="admin-logo" to="/overview" aria-label="返回 Overview">
    <span class="admin-logo__mark">
      <CodeOutlined />
    </span>
    <span v-if="!collapsed" class="admin-logo__copy">
      <strong>Agent Console</strong>
      <small>Runtime workspace</small>
    </span>
  </RouterLink>
</template>

<style scoped>
.admin-logo {
  display: flex;
  height: var(--admin-header-height);
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  color: var(--admin-text);
  text-decoration: none;
}

.admin-logo__mark {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border-radius: 9px;
  color: #fff;
  background: var(--admin-primary);
  box-shadow: 0 5px 14px rgb(0 111 230 / 24%);
  font-size: 17px;
}

.admin-logo__copy {
  display: grid;
  min-width: 0;
  line-height: 1.1;
  white-space: nowrap;
}

.admin-logo__copy strong {
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.admin-logo__copy small {
  margin-top: 4px;
  color: var(--admin-text-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
