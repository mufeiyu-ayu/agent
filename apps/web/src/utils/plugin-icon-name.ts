/** 上传图标优先；系统目录无自定义图标时显示对应品牌。 */
export function pluginIconName(id: string): string {
  return ({
    'google-developer-knowledge': 'logos:google-icon',
    'gmail': 'logos:google-gmail',
    'github': 'simple-icons:github',
    'cloudflare': 'logos:cloudflare-icon',
  } as Record<string, string>)[id] ?? 'tabler:plug'
}
