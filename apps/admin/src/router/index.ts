import { createRouter, createWebHistory } from 'vue-router'

import { useAuth } from '@/features/auth/auth.state'

declare module 'vue-router' {
  interface RouteMeta {
    activeMenu?: string
    requiresAuth?: boolean
    requiresAdmin?: boolean
    title?: string
    titleKey?: string
    tab?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { title: 'Sign in', titleKey: 'auth.login.title' },
    },
    {
      path: '/change-password',
      name: 'change-password',
      component: () => import('@/views/ChangePasswordView.vue'),
      meta: { title: 'Change password', titleKey: 'auth.changePassword.title', requiresAuth: true },
    },
    {
      path: '/forbidden',
      name: 'forbidden',
      component: () => import('@/views/ForbiddenView.vue'),
      meta: { title: 'No permission', titleKey: 'auth.forbidden.title', requiresAuth: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      redirect: '/overview',
      // 子路由继承：管理台所有页面都要求管理员。
      meta: { requiresAuth: true, requiresAdmin: true },
      children: [
        {
          path: 'overview',
          name: 'overview',
          component: () => import('@/views/OverviewView.vue'),
          meta: { title: 'Overview', titleKey: 'navigation.overview', tab: true },
        },
        {
          path: 'conversations',
          name: 'conversations',
          component: () => import('@/views/ConversationsView.vue'),
          meta: { title: 'Conversations', titleKey: 'navigation.conversations', tab: true },
        },
        {
          path: 'conversations/:conversationId',
          name: 'conversation-detail',
          component: () => import('@/views/ConversationDetailView.vue'),
          meta: {
            activeMenu: '/conversations',
            title: 'Conversation Detail',
            titleKey: 'navigation.conversationDetail',
            tab: true,
          },
        },
        {
          path: 'runs',
          name: 'runs',
          component: () => import('@/views/RunsView.vue'),
          meta: { title: 'Runs', titleKey: 'navigation.runs', tab: true },
        },
        {
          path: 'runs/:runId',
          name: 'run-detail',
          component: () => import('@/views/RunDetailView.vue'),
          meta: {
            activeMenu: '/runs',
            title: 'Run Detail',
            titleKey: 'navigation.runDetail',
            tab: true,
          },
        },
        {
          path: 'llm-models',
          name: 'llm-models',
          component: () => import('@/views/LlmModelsView.vue'),
          meta: { title: 'Model Access', titleKey: 'navigation.llmModels', tab: true },
        },
        {
          path: 'runtime-config',
          name: 'runtime-config',
          component: () => import('@/views/RuntimeConfigView.vue'),
          meta: { title: 'Runtime Settings', titleKey: 'navigation.runtimeConfig', tab: true },
        },
        {
          path: 'workspaces',
          name: 'workspaces',
          component: () => import('@/views/WorkspacesView.vue'),
          meta: { title: 'Workspaces', titleKey: 'navigation.workspaces', tab: true },
        },
        {
          path: 'users',
          name: 'users',
          component: () => import('@/views/UsersView.vue'),
          meta: { title: 'Users', titleKey: 'navigation.users', tab: true },
        },
      ],
    },
    {
      path: '/404',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: 'Page not found', titleKey: 'navigation.notFound' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/404',
    },
  ],
})

// 页面守卫只管体验；真正的鉴权在后端，成员直接调 /api/admin/* 同样返回 403。
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

  if (to.meta.requiresAdmin && user.role !== 'ADMIN')
    return { name: 'forbidden' }

  return true
})
