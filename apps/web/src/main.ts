import { createApp } from 'vue'

import App from '@/App.vue'
import { i18n, initialLocale, syncDocumentLocale } from '@/i18n'
import { router } from '@/router'
import '@/style.css'

syncDocumentLocale(initialLocale)

createApp(App).use(router).use(i18n).mount('#app')
