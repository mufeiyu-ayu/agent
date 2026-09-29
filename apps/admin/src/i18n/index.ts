import { createI18n } from 'vue-i18n'

import { messages } from './messages'
import 'dayjs/locale/zh-cn'

/** 管理台只有中文：文案集中在 messages.ts，页面经 t() 取用。 */
export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages,
})

if (typeof document !== 'undefined')
  document.documentElement.lang = 'zh-CN'
