import { createRouter, createWebHistory } from 'vue-router'

import HomeView from '@/views/HomeView.vue'
import SeoWorkspaceView from '@/views/SeoWorkspaceView.vue'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: SeoWorkspaceView,
    },
  ],
})
