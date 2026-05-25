# 项目目录说明

当前项目使用最小学习结构：根目录保留工程配置，`src` 目录放 TypeScript 示例代码，`docs` 目录记录 Agent 应用开发学习过程。

```text
.
├── AGENTS.md
├── README.md
├── PROJECT_STRUCTURE.md
├── .codex/
│   └── skills/
│       └── update-agent-learning-log/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.mjs
├── .env.example
├── .gitignore
├── docs/
│   └── learning-log.md
└── src/
    ├── Index.ts
    ├── services/
    │   └── deepseek-chat.ts
    ├── types/
    │   └── deepseek.ts
    └── utils/
        └── messages.ts
```

## `src/Index.ts`

当前示例入口。它组织 `messages`，调用 DeepSeek chat completion，并演示第二轮问题如何复用第一轮上下文。

## `src/services/deepseek-chat.ts`

封装 DeepSeek OpenAI-compatible API 调用，负责创建 OpenAI SDK client、读取 `DEEPSEEK_API_KEY`，并发起非流式 chat completion 请求。

```ts
const params: DeepSeekChatCompletionParams = {
  model: 'deepseek-v4-flash',
  messages,
  thinking: { type: 'disabled' },
  stream: false,
}
```

因为 `thinking` 是 DeepSeek 在 OpenAI 兼容接口上的扩展字段，OpenAI SDK 的 TypeScript 类型不一定直接认识它，所以项目在 `src/types/deepseek.ts` 中补充了一个很小的扩展类型。

## `src/utils/messages.ts`

封装把模型回复追加为 `assistant` message 的逻辑，帮助理解多轮对话上下文如何由调用方维护。

## `docs/learning-log.md`

记录项目学习过程，包括当前阶段、Agent 概念、关键代码入口、验证结果、复盘和下一步。

## `.codex/skills/update-agent-learning-log`

项目内学习日志 skill，只服务于当前仓库，用于规范触发和更新 `docs/learning-log.md`，不放到全局 Codex skill 目录。

## 根目录文件

- `package.json`：声明依赖和脚本。
- `tsconfig.json`：TypeScript 编译配置。
- `eslint.config.mjs`：使用 `@antfu/eslint-config` 管理格式和代码风格。
- `.env.example`：环境变量模板，真实 API Key 放到 `.env`。
- `README.md`：最小运行说明。
