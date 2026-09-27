import { createRouter, createWebHistory } from 'vue-router'

import { useAuth } from '@/hooks/useAuth'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      // 落地页纯静态、不调 API，不需要登录。
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('@/views/ChangePasswordView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: () => import('@/views/ChatWorkspaceView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

// 页面守卫只管体验；真正的鉴权在后端，未登录直接调 API 同样被拒。
router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth)
    return true

  // API 暂时不可用时放行，由页面自己的请求报错；真掉登录时它们的 401 会统一跳登录页。
  const user = await useAuth().loadCurrentUser().catch(() => undefined)

  if (user === undefined)
    return true

  if (!user)
    return { name: 'login', query: { redirect: to.fullPath } }

  if (user.mustChangePassword && to.name !== 'change-password')
    return { name: 'change-password', query: { redirect: to.fullPath } }

  return true
})
