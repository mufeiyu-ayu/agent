<script setup lang="ts">
import type { UserProfile } from '@agent/contracts'
import { userInitial } from '@agent/contracts'
import { ref, watch } from 'vue'

/** 用户头像：有 Google 头像显示图片；没有或加载失败（国内未开梯子时 Google 图床打不开）显示首字母。 */
const props = withDefaults(defineProps<{ user: UserProfile, size?: number }>(), { size: 32 })

const failed = ref(false)
watch(() => props.user.avatarUrl, () => {
  failed.value = false
})
</script>

<template>
  <span class="user-avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.45)}px` }">
    <img v-if="user.avatarUrl && !failed" :src="user.avatarUrl" alt="" referrerpolicy="no-referrer" @error="failed = true">
    <template v-else>{{ userInitial(user) }}</template>
  </span>
</template>

<style scoped>
.user-avatar {
  display: inline-grid;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
  font-weight: 600;
  line-height: 1;
}

.user-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
