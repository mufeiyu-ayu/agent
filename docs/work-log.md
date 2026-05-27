# 项目工作记录

本文件用于记录每次阶段性开发、提交或重要讨论的上下文，帮助 Codex 后续快速恢复项目记忆。

`docs/learning-log.md` 记录“学到了什么 Agent 概念”；本文件记录“项目推进了什么、这次 commit 或阶段完成了什么”。

## 当前项目状态

| 模块 | 当前状态 | 已完成 | 下一步 |
| --- | --- | --- | --- |
| 项目架构 | 进行中 | 已迁移为 `pnpm workspace`，拆分 `apps/api` 与 `apps/web` | 把 AI SEO 能力接入后端接口 |
| 后端 API | 初始完成 | NestJS demo 接口 `GET /api/demo` 可访问 | 新增最小 AI SEO Agent 接口 |
| 前端 Web | 初始完成 | Vue 通过 axios 请求 Nest demo 接口 | 增加 SEO 表单并调用后端 |
| Agent 能力 | 学习迁移中 | 已学习 API 调用、多轮对话、JSON Output、Tool Calling、Streaming | 将 DeepSeek JSON Output 落到 Nest 服务中 |

## 工作记录

| 日期 | 提交 | 类型 | 目标 | 核心完成 | 业务进度 | 讨论与决策 | 关键文件 | 验证结果 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-28 | `edb34ee feat: 搭建前后端工作区骨架` | 架构迁移 | 从单文件 CLI 学习项目升级为前后端工程骨架 | 新增 `apps/api` Nest 后端、`apps/web` Vue/Vite 前端、axios 请求封装，删除旧根目录 `src/` 示例代码 | 前端已能通过 Vite 代理访问 Nest demo 接口 | 确认使用 Vue + Nest + pnpm workspace，根目录保留 Antfu ESLint；旧 `src/` 可删除，后续模型调用放到后端 | `pnpm-workspace.yaml`、`apps/api/src/app.controller.ts`、`apps/web/src/api/http.ts`、`apps/web/src/App.vue` | `pnpm typecheck`、`pnpm lint`、`pnpm --filter @agent/web build` 通过；`curl` 验证 `localhost:3000/api/demo` 与 `localhost:5173/api/demo` 均返回后端数据 | 在 Nest 中实现最小 AI SEO Agent 接口，并由 Vue 表单调用 |
| 2026-05-28 | `edb34ee feat: 搭建前后端工作区骨架` | 工作流规范 | 新增提交专用 skill，固定提交前后的项目记忆更新流程 | 创建 `.codex/skills/git-commit`，要求 commit 前更新 `docs/work-log.md`，必要时更新 `docs/learning-log.md`，再运行验证和提交 | 项目具备更稳定的 Codex 记忆维护流程 | 明确 skill 不能自动调用 skill，但可以在 `git-commit` 流程中规定 Codex 主动执行两个日志更新职责 | `.codex/skills/git-commit/SKILL.md`、`AGENTS.md`、`docs/work-log.md` | `pnpm lint`、`pnpm typecheck`、`pnpm --filter @agent/web build` 通过 | 下次用户要求 commit 时，使用该 skill 串起记录、验证和提交 |

## 记录规则

- 每次阶段性开发、重要讨论或 commit 前后补一条记录。
- 如果记录发生在 commit 前，`提交` 写 `待提交`；如果已经 commit，写短 hash 和提交信息。
- 只记录核心事实：目标、完成内容、业务进度、关键决策、验证结果和下一步。
- 学习概念写入 `docs/learning-log.md`；项目推进和 commit 上下文写入本文件。
- 不记录 API Key、token、密码、私有服务密钥等敏感信息。
