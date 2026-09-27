<script setup lang="ts">
import { useHomeLogin } from './home-login'

// 已登录直达工作台；未登录打开登录弹窗，地址栏不变。
const { loggedIn, openLogin } = useHomeLogin()
</script>

<template>
  <RouterLink v-if="loggedIn" to="/workspace">
    <slot />
  </RouterLink>
  <button v-else type="button" @click="openLogin">
    <slot />
  </button>
</template>
