# AI SEO Agent 学习项目

这个项目用于学习 Agent 应用开发，并逐步搭建一个小型 AI SEO Agent 助手。

当前代码采用轻量 pnpm workspace：

```txt
apps/api  -> NestJS 后端
apps/web  -> Vue + Vite 前端
docs/     -> 学习日志
context/  -> 项目规划和上下文
```

## 快速开始

```sh
pnpm install
pnpm dev:api
pnpm dev:web
```

然后打开：

```txt
http://localhost:5173
```

前端会通过 axios 请求：

```txt
GET /api/demo
```

Vite 开发代理会把请求转发到 Nest：

```txt
http://localhost:3000/api/demo
```

## 常用命令

```sh
pnpm dev          # 同时启动 api 和 web
pnpm dev:api      # 启动 Nest API
pnpm dev:web      # 启动 Vue 前端
pnpm typecheck    # 检查 apps 下所有 TypeScript 项目
pnpm lint
pnpm lint:fix
```

## 当前阶段

第一阶段 LLM API 基础概念已完成。当前开始进入第二阶段：把模型能力接入 NestJS 后端和 Vue 前端，逐步形成可运行的小型 AI SEO Agent 产品。

项目规划见：

```txt
context/ai-seo-agent-plan.md
```

学习过程记录在：

```txt
docs/learning-log.md
```
