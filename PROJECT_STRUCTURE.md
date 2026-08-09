# 项目目录说明

本仓库已经从早期 TypeScript / NestJS + Vue 示例演进为一个 pnpm monorepo，用于学习和实现可观测的 TypeScript Agent Runtime。

当前正式状态以 `docs/tasks/**` 和 `docs/roadmap.md` 为准；本文件只说明仓库结构，不维护任务看板。

## 顶层结构

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
│   ├── api/          # NestJS Agent API / Runtime
│   ├── web/          # Vue Chat 前端
│   └── admin/        # Agent Runtime Console
├── packages/
│   └── contracts/    # 前后端共享 TypeScript contracts / 产品限制
├── prisma/           # PostgreSQL schema、migration、fixtures / seed
└── docs/
    ├── README.md
    ├── roadmap.md
    ├── development-workflow.md
    ├── development-task-plan.md   # 仅旧链接兼容
    ├── tasks/
    │   ├── README.md
    │   ├── admin-console.md
    │   ├── _template.tdd.md
    │   └── completed/
    ├── research/
    └── work-log.md
```

## `apps/api`

NestJS 后端，负责 Agent 产品的服务端执行与持久化边界。

主要代码区域：

```text
apps/api/src/
├── agent-runtime/   # AgentRun / AgentStep、bounded loop、deadline、终态收口
├── llm/             # Provider client、model input / stream event、DeepSeek continuation
├── tools/
│   ├── core/        # Tool contract、Registry、Invocation、Observation
│   └── articles/    # search_articles / get_article_detail
├── seo/             # 当前 Agent 业务入口、Prompt 与 Chat 协议适配
├── prisma/          # PrismaService 与 Run-scoped DB reliability boundary
├── common/          # NestJS 全局 bootstrap / filter / interceptor 等通用能力
├── app.module.ts
└── main.ts
```

当前核心 Runtime 支持：

- policy 驱动的 bounded sequential Agent Loop；
- 默认 3 次 sampling / 2 次 Tool Call；
- `search_articles` / `get_article_detail` Run allowlist；
- DeepSeek thinking Tool Call continuation；
- Streaming、Abort、Tool timeout、Run deadline；
- PostgreSQL statement / lock timeout、late-result ownership fencing；
- Message / AgentStep / AgentRun 终态持久化。

同步与流式 SEO Chat 入口共享 `AgentRuntimeService.runTurnStream()`，外部流协议保持 `start / delta / done / error / aborted`。

## `apps/web`

Vue 3 + Vite + TypeScript Chat 前端。

职责包括：

- 会话与消息交互；
- NDJSON 流消费；
- 停止生成；
- 与 API 的用户可见 Chat contract 对接。

前端不直接持有模型平台 API Key，也不把 AgentStep / Tool 内部执行事实混进普通聊天消息。

## `apps/admin`

独立 Agent Runtime Console 前端，当前已完成基础壳和静态 Run List / Run Detail UI。

真实 Run / Step 查询 API、真实数据接入、登录 / 权限仍属于独立 Planned 产品任务；具体状态见 `docs/tasks/admin-console.md`。

## `packages/contracts`

前后端共享的 TypeScript contracts 与公开产品限制。

这一区域用于需要 API / Web 一致的稳定契约，不用于存放 Agent Runtime 内部实现细节。

## `prisma`

PostgreSQL 数据模型、migration 与演示数据。

当前核心持久化对象包括：

- `Conversation`；
- `Message`；
- `AgentRun`；
- `AgentStep`；
- Article 业务数据。

Run-scoped 数据库 timeout / terminalization 实现位于 `apps/api/src/prisma/`，不是 Prisma schema 本身的职责。

## `docs`

当前文档职责：

| 路径 | 用途 |
| --- | --- |
| `docs/README.md` | 文档总入口 |
| `docs/tasks/README.md` | 正式 Task 状态事实来源 |
| `docs/tasks/completed/**` | 已完成阶段的精简归档 |
| `docs/tasks/admin-console.md` | Admin Console 独立产品支线 |
| `docs/roadmap.md` | 阶段级路线与当前主线状态 |
| `docs/development-workflow.md` | Issue / Gate / Codex / PR / 验收 / 合并流程 |
| `docs/development-task-plan.md` | 旧链接兼容，不再维护第二套任务路线 |
| `docs/research/**` | 源码研究、学习路线、长期候选能力；不代表当前状态 |
| `docs/work-log.md` | 近期真实推进与收口记录 |

Phase 6 已归档到：

`docs/tasks/completed/phase-06-bounded-agent-loop.md`

当前 Agent 主线没有 Active Task；下一正式阶段需要重新基于最新 `master`、产品需求和学习收益确定。
