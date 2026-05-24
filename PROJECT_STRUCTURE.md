# 项目目录说明

当前项目先使用最小学习结构：根目录保留工程配置，`src` 目录里只放一个 `Index.ts`，方便先跑通 DeepSeek API Key 和一次模型调用。

```text
.
├── AGENTS.md
├── README.md
├── PROJECT_STRUCTURE.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.mjs
├── .env.example
├── .gitignore
└── src/
    └── Index.ts
```

## `src/Index.ts`

唯一的业务入口。代码基本按照 DeepSeek 官方 Node.js 示例写法调用：

```ts
const completion = await openai.chat.completions.create({
  messages: [{ role: 'system', content: 'You are a helpful assistant.' }],
  model: 'deepseek-v4-pro',
  thinking: { type: 'enabled' },
  reasoning_effort: 'high',
  stream: false,
})
```

因为 `thinking` 是 DeepSeek 在 OpenAI 兼容接口上的扩展字段，OpenAI SDK 的 TypeScript 类型不一定直接认识它，所以 `Index.ts` 中保留了一个很小的类型转换。

## 根目录文件

- `package.json`：声明依赖和脚本。
- `tsconfig.json`：TypeScript 编译配置。
- `eslint.config.mjs`：使用 `@antfu/eslint-config` 管理格式和代码风格。
- `.env.example`：环境变量模板，真实 API Key 放到 `.env`。
- `README.md`：最小运行说明。
