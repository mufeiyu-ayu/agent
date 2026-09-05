import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    activeMenu?: string
    title?: string
    titleKey?: string
    tab?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: () => import('@/layouts/AdminLayout.vue'),
      redirect: '/overview',
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
