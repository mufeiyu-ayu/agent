import { messages } from '../i18n/messages'

/** 只翻译内置初始文案；管理员改名、改简介后保留原文，不改写配置或消息事实。 */
export function pluginText(
  plugin: { id: string, name: string, description?: string },
  field: 'name' | 'description',
  locale: string,
): string {
  const value = plugin[field] ?? ''
  const defaults = messages['zh-CN'].plugins.builtins
  if (!Object.hasOwn(defaults, plugin.id))
    return value
  const id = plugin.id as keyof typeof defaults
  return value === defaults[id][field] && locale === 'en-US'
    ? messages['en-US'].plugins.builtins[id][field]
    : value
}
