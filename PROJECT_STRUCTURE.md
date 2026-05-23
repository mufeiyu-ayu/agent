# 项目目录说明

这个项目是一个面向 Agent 开发学习的 TypeScript 基础框架。当前阶段先把 DeepSeek API 调用、上下文管理、工具调用和简化 Agent loop 拆清楚，后续可以继续演进成多角色或 MOR 架构。

## 根目录

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
```

### `AGENTS.md`

当前项目的 Agent 协作规则，包含默认语言、技术栈、学习优先的协作方式和代码风格要求。

### `README.md`

项目入口说明，包含快速开始、常用命令、目录结构和 MOR 架构取舍。

### `PROJECT_STRUCTURE.md`

当前文件，用来解释项目目录和每个模块的学习价值。

### `package.json`

项目脚本和依赖声明。当前主要脚本包括：

```sh
pnpm dev
pnpm example:basic
pnpm example:stream
pnpm example:tool
pnpm typecheck
pnpm lint
pnpm lint:fix
```

### `tsconfig.json`

TypeScript 编译配置。当前开启严格类型检查，适合学习时尽早暴露类型边界问题。

### `eslint.config.mjs`

使用 `@antfu/eslint-config` 的 ESLint 配置，同时允许 CLI 示例中使用 `console.log` 输出结果。

### `.env.example`

环境变量示例文件。真实 API Key 放在 `.env` 中，不提交到仓库。

## `src/` 目录

```text
src/
├── config.ts
├── index.ts
├── deepseek/
│   ├── client.ts
│   ├── chat.ts
│   └── types.ts
├── agent/
│   ├── memory.ts
│   ├── runner.ts
│   └── tools.ts
└── examples/
    ├── 01-basic-chat.ts
    ├── 02-stream-chat.ts
    └── 03-tool-call.ts
```

### `src/config.ts`

负责读取和校验环境变量，例如 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_THINKING` 和 `DEEPSEEK_REASONING_EFFORT`。

这里使用 `zod` 做校验，是为了让配置错误尽早失败，而不是等到 API 请求时才报一个不清楚的错误。

### `src/index.ts`

默认运行入口。它创建一个简化 Agent，并提出一个学习型问题，用来验证整个调用链路是否能跑通。

### `src/deepseek/client.ts`

创建 DeepSeek 的 OpenAI SDK client。

核心配置是：

```ts
const client = new OpenAI({
  baseURL: env.DEEPSEEK_BASE_URL,
  apiKey: env.DEEPSEEK_API_KEY,
})
```

### `src/deepseek/chat.ts`

封装 DeepSeek Chat Completions 调用。

DeepSeek 的 `thinking` 是 OpenAI 兼容 API 上的扩展字段，SDK 类型不一定完整覆盖，所以这里把类型兼容集中收在 DeepSeek 边界里，避免业务代码里到处写类型断言。

### `src/deepseek/types.ts`

定义 DeepSeek 相关类型，例如模型名、thinking 开关、reasoning effort、请求参数和返回内容中的 reasoning 字段。

这层的作用是把“DeepSeek 特有概念”和普通业务代码隔离开。

### `src/agent/memory.ts`

一个很小的多轮上下文容器。

它负责保存 `system`、`user`、`assistant`、`tool` 等消息。学习 Agent 时，理解消息如何被追加和重新传给模型，是理解上下文管理的第一步。

### `src/agent/tools.ts`

定义本地工具。

当前示例工具是 `get_current_time`，用于演示模型如何请求工具、程序如何执行工具、工具结果如何再回填给模型。

### `src/agent/runner.ts`

简化版 Agent loop。

它的流程是：

```text
用户输入
  -> 加入 memory
  -> 调用模型
  -> 如果模型请求工具，执行工具并写回 memory
  -> 再次调用模型
  -> 如果没有工具请求，返回最终回答
```

这个文件是后续演进的核心位置。未来可以把它拆成 planner、executor、critic，或者进一步扩展成 MOR / 多角色协作结构。

## `src/examples/` 示例

### `01-basic-chat.ts`

最基础的非流式调用示例，适合第一次验证 API Key、模型名和请求参数是否正确。

### `02-stream-chat.ts`

流式输出示例，适合学习如何边生成边展示内容，以及如何处理流式返回中的增量内容。

### `03-tool-call.ts`

工具调用示例，展示一个最小 Agent loop 如何让模型调用本地工具并生成最终回答。

## 当前架构取舍

当前不直接引入完整 MOR 架构，而是先保留轻量扩展点。这样做的好处是学习路径更清楚：

```text
基础模型调用
  -> 多轮上下文
  -> 工具调用
  -> Agent loop
  -> 多工具编排
  -> 多角色或 MOR 架构
```

当这些基础概念跑通以后，再引入 planner、executor、reviewer 或多角色协作，会更容易理解每一层到底解决了什么问题。
