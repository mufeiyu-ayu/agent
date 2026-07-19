import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from '@/App.vue'
import { router } from '@/router'
import 'ant-design-vue/dist/reset.css'
import '@/styles/index.css'

createApp(App).use(createPinia()).use(router).mount('#app')
