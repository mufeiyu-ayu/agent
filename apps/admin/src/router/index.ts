import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    parentPath?: string
    parentTitle?: string
    title?: string
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
          meta: { title: 'Overview', tab: true },
        },
        {
          path: 'runs',
          name: 'runs',
          component: () => import('@/views/RunsView.vue'),
          meta: { title: 'Runs', tab: true },
        },
        {
          path: 'runs/:runId',
          name: 'run-detail',
          component: () => import('@/views/RunDetailView.vue'),
          meta: {
            title: 'Run Detail',
            tab: true,
            parentTitle: 'Runs',
            parentPath: '/runs',
          },
        },
      ],
    },
    {
      path: '/404',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
      meta: { title: '页面不存在' },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/404',
    },
  ],
})

router.afterEach((route) => {
  document.title = route.meta.title
    ? `${route.meta.title} · Agent Console`
    : 'Agent Console'
})
