# 项目目录说明

当前项目已经从根目录 TypeScript CLI 示例，迁移为轻量 pnpm workspace，用于继续搭建 AI SEO Agent 助手。

```text
.
├── AGENTS.md
├── README.md
├── PROJECT_STRUCTURE.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── eslint.config.mjs
├── .env.example
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       └── app.controller.ts
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       └── src/
│           ├── main.ts
│           ├── App.vue
│           └── api/
│               ├── http.ts
│               └── demo.ts
├── context/
│   └── ai-seo-agent-plan.md
└── docs/
    ├── development-task-plan.md
    ├── tasks/
    └── work-log.md
```

## `apps/api`

NestJS 后端应用。

当前提供两个最小接口：

- `GET /health`
- `GET /api/demo`

运行方式：

```sh
pnpm dev:api
```

## `apps/web`

Vue + Vite 前端应用。

当前页面通过 axios 请求 `GET /api/demo`，并由 Vite proxy 转发到 `http://localhost:3000`。

运行方式：

```sh
pnpm dev:web
```

## 根目录配置

- `pnpm-workspace.yaml`：声明 `apps/*` workspace。
- `package.json`：统一管理根命令。
- `tsconfig.base.json`：前后端共享的 TypeScript 基础规则。
- `eslint.config.mjs`：继续使用 `@antfu/eslint-config`。

## 文档目录

- `context/ai-seo-agent-plan.md`：AI SEO Agent 项目规划。
- `docs/development-task-plan.md`：项目阶段任务主看板。
- `docs/tasks/`：阶段任务拆解。
- `docs/work-log.md`：项目推进、commit 上下文和关键决策。
