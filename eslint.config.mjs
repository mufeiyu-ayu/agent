if (!Object.groupBy) {
  Object.defineProperty(Object, 'groupBy', {
    configurable: true,
    value(items, keySelector) {
      const result = Object.create(null)

      let index = 0

      for (const item of items) {
        const key = keySelector(item, index)
        const propertyKey = typeof key === 'symbol' ? key : String(key)

        if (!Object.hasOwn(result, propertyKey))
          result[propertyKey] = []

        result[propertyKey].push(item)
        index += 1
      }

      return result
    },
  })
}

const { default: antfu } = await import('@antfu/eslint-config')

export default antfu({
  type: 'app',
  typescript: true,
  vue: true,
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: false,
  },
  ignores: [
    '**/dist',
    '**/node_modules',
    'apps/api/src/generated/prisma',
    // 研究资料：摘录的 Pi 源码按原文保留、图表构建脚本不属于产品代码，不参与 lint。
    'docs/research/**',
  ],
  rules: {
    'no-console': ['error', {
      allow: ['log', 'warn', 'error'],
    }],
    // 测试标题是中文或以类名、HTTP 方法、AC 编号开头，不要求小写开头。
    'test/prefer-lowercase-title': 'off',
  },
}, {
  // 管理台展示的参数、observation、模型文本都是不可信数据，一律按文本渲染；前台 Markdown 渲染另有净化，不受此限。
  files: ['apps/admin/**/*.vue'],
  rules: {
    'vue/no-v-html': 'error',
  },
}, {
  // antfu 默认还要求 minimumReleaseAgeExcludePrune，那是 pnpm 11 的设置，pnpm 10 不认；只保留另外两项。
  files: ['pnpm-workspace.yaml'],
  rules: {
    'pnpm/yaml-enforce-settings': ['error', { settings: { shellEmulator: true, trustPolicy: 'no-downgrade' } }],
  },
})
