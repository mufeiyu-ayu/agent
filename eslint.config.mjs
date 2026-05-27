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
  ],
  rules: {
    'no-console': ['error', {
      allow: ['log', 'warn', 'error'],
    }],
  },
})
