<script setup lang="ts">
import type { UserProfile } from '@agent/contracts'
import { userDisplayName } from '@agent/contracts'

import UserAvatar from './UserAvatar.vue'

/** 头像 + 显示名 + 邮箱：用户列表、会话记录与会话详情共用。 */
withDefaults(defineProps<{ user: UserProfile, size?: number }>(), { size: 32 })
</script>

<template>
  <span class="user-identity">
    <UserAvatar :user="user" :size="size" />
    <span class="user-identity__text">
      <strong>{{ userDisplayName(user) }}</strong>
      <small>{{ user.email }}</small>
    </span>
  </span>
</template>

<style scoped>
.user-identity {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.user-identity__text {
  min-width: 0;
}

.user-identity strong,
.user-identity small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-identity strong {
  font-weight: 500;
}

.user-identity small {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}
</style>
