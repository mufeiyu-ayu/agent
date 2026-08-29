import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    activeMenu?: string
    parentPath?: string
    parentTitle?: string
    parentTitleKey?: string
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
            parentTitle: 'Conversations',
            parentTitleKey: 'navigation.conversations',
            parentPath: '/conversations',
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
            parentTitle: 'Runs',
            parentTitleKey: 'navigation.runs',
            parentPath: '/runs',
          },
        },
        {
          path: 'qa/articles',
          name: 'qa-articles',
          component: () => import('@/views/QaArticlesView.vue'),
          meta: { title: 'QA Articles', titleKey: 'navigation.qaArticles', tab: true },
        },
        {
          path: 'qa/articles/:articleId',
          name: 'qa-article-detail',
          component: () => import('@/views/QaArticleDetailView.vue'),
          meta: {
            activeMenu: '/qa/articles',
            title: 'Translation QA',
            titleKey: 'navigation.qaArticleDetail',
            tab: true,
            parentTitle: 'QA Articles',
            parentTitleKey: 'navigation.qaArticles',
            parentPath: '/qa/articles',
          },
        },
        {
          path: 'qa/glossaries',
          name: 'qa-glossaries',
          component: () => import('@/views/QaGlossariesView.vue'),
          meta: { title: 'QA Glossaries', titleKey: 'navigation.qaGlossaries', tab: true },
        },
        {
          path: 'qa/glossaries/:glossaryId',
          name: 'qa-glossary-terms',
          component: () => import('@/views/QaGlossaryTermsView.vue'),
          meta: {
            activeMenu: '/qa/glossaries',
            title: 'Glossary Terms',
            titleKey: 'navigation.qaGlossaryTerms',
            tab: true,
            parentTitle: 'Glossaries',
            parentTitleKey: 'navigation.qaGlossaries',
            parentPath: '/qa/glossaries',
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
