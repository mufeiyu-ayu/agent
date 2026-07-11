# AGENTS.md

## codex 必须遵守的规则!
- DO NOT send optional commentary ！！！！

## 1. 项目定位

本项目用于学习并实践 Agent 应用开发。目标不是只把代码写完，而是通过一个 Vue + NestJS + TypeScript 的 AI SEO Agent 项目，逐步掌握：

- LLM API 调用
- 多轮对话与上下文管理
- Streaming
- Agent Run / Step
- Tool Calling
- Human-in-the-loop
- 权限边界、错误恢复和可观测性

Codex 应作为 Agent 应用开发学习搭档，既帮助实现，也在关键设计点解释为什么这样做。

## 2. 用户背景与回答方式

用户是约 4 年经验的前端开发工程师，熟悉 Vue / Nuxt / TypeScript / Tailwind，后端只需要按 AI 应用开发够用的深度学习 Node.js / NestJS。

协作要求：

- 始终使用中文沟通。
- 默认使用 TypeScript / Node.js / NestJS / Vue 方案。
- 不默认使用 Python、Rust，除非场景明显更合适。
- 解释后端、Agent、LLM 概念时，优先用前端工程类比。
- 小任务直接推进；中等或复杂任务先简短说明计划、涉及文件和风险。
- 不做空泛鼓励，重点服务“能做出真实 Agent 应用”。

## 3. 当前文档入口

当前 docs 已重组，后续不要再把 `docs/development-task-plan.md` 当主看板。

| 文档 | 用途 |
| --- | --- |
| `docs/README.md` | 文档总入口 |
| `docs/roadmap.md` | 阶段路线总览 |
| `docs/tasks/README.md` | 当前任务看板，Active / Completed 以这里为准 |
| `docs/tasks/_template.tdd.md` | 新任务 TDD 模板 |
| `docs/development-workflow.md` | GPT、Issue、Codex、PR、Review 与学习验收规范 |
| `docs/tasks/phase-05-tool-calling/` | 阶段 5 最小 Tool Calling 任务入口 |
| `docs/tasks/completed/` | 已完成阶段归档 |
| `docs/research/` | 研究资料，不直接当执行任务 |
| `docs/work-log.md` | commit 级工作记录 |
| `docs/optimization-backlog.md` | 暂不立即实现的优化项 |

`docs/development-task-plan.md` 只保留为旧入口兼容，不再写入新任务。

## 4. 关键目录与任务入口

修改代码前，先快速确认相关上下文：

- 先看 `docs/tasks/README.md` 判断当前 Active 任务。
- 再阅读当前阶段目录下的具体任务文档。
- 是否已有相邻 service、controller、hook、component、utils、contract 可复用。
- 是否涉及 Prisma schema、contracts、前后端协议或文档同步。

| 目录 | 用途 |
| --- | --- |
| `apps/web/src/` | Vue 前端页面、组件、hooks、API 和状态 |
| `apps/api/src/` | NestJS API、业务模块和应用入口 |
| `apps/api/src/agent-runtime/` | Agent Run 编排与运行记录 |
| `apps/api/src/llm/` | 模型调用、provider adapter 和模型流事件 |
| `apps/api/src/seo/` | SEO Agent 业务入口、上下文与协议适配 |
| `packages/contracts/` | 前后端共享协议与类型 |
| `prisma/` | schema、migration、fixtures 和 seed |
| `docs/tasks/` | 当前任务、阶段入口和已完成归档 |
| `docs/research/` | 研究资料，不直接作为执行任务 |

## 5. 工作方式与 Skill 触发

只有以下明确表达触发项目 GitHub 工作流：

| 用户意图 | 必须使用 |
| --- | --- |
| “完成 Issue #N”“读取 Issue #N 并实现” | `.codex/skills/github-issue-workflow` |
| “处理 PR #N 的 Review” | `.codex/skills/github-pr-review-fix` |
| “GPT 已确认 Issue #N 验收通过，我也确认通过，请收口” | `.codex/skills/github-issue-workflow` |
| “合并 PR #N 并清理分支” | `.codex/skills/github-issue-workflow` |

其他学习、讨论、inspection-only、本地实验和小改动默认自由进行，不自动切任务分支、commit、push、创建 PR 或更新任务状态。用户可以在本次指令中扩大或缩小流程。

硬性规则：

- `docs/tasks/**` 是任务与阶段状态的事实来源；Issue 只保存实施快照。
- 正式代码任务必须使用 `codex/` 任务分支，不直接在 `master` 上实现、提交或推送。
- 一个 Issue / PR 只完成一个任务单元；Codex 实现完成后只记录“已实现、待验收”，默认停止在 Draft PR、验证结果和学习交接。
- 只有 GPT 给出验收通过结论且用户明确确认后，才能把任务写成已通过 / Completed、推进路线或归档阶段。
- 未经用户明确确认，不转为 Ready、不合并、不自动修复全部 Review findings。
- Review 默认先解释、再由本地 Codex 修复；只有用户明确选择时才交给云端修复，禁止本地与云端同时修改同一 PR。
- 当前不把 GitHub Actions 作为必需环节；以本地最小必要验证和自动 Codex Review 为主。
- 用户明确说“直接在 master 提交并 push”时，低风险 typo、文案、样式微调或普通 docs 修正可以绕过 Issue / PR；涉及功能行为、API / contracts、数据库、Agent Runtime、Streaming、Tool Calling、依赖、环境、安全或正式任务状态时禁止绕过。

## 6. 代码与架构原则

默认保持“小步可运行”：

1. 先跑通最小功能。
2. 再解释关键概念。
3. 再封装可复用边界。
4. 最后再考虑工程化扩展。

不要过早引入：

- Multi-agent
- 复杂 RAG
- LangGraph / workflow engine
- MCP / plugin marketplace
- OS sandbox
- 本地模型部署
- 微调模型

Agent 相关实现优先分层：

```txt
Controller -> Service -> AgentRuntime -> LLMService / ToolRegistry -> Prisma
```

当前阶段尤其注意：

- `Conversation` 是长期会话。
- `Message` 是用户可见消息。
- `AgentRun` 是一次用户输入触发的运行。
- `AgentStep` 是系统执行过程，不是模型真实 chain-of-thought。
- UI message 不等于 model message。
- delta 不等于持久化事实。

## 7. NestJS 约束

修改 Controller 前先检查 `apps/api/src/common/bootstrap/register-app-globals.ts`。

普通 Controller 不要重复实现全局能力：

- DTO 校验交给全局 `createAppValidationPipe()`。
- 成功响应包装交给 `ResponseTransformInterceptor`。
- 异常格式交给 `AllExceptionsFilter`。

Controller 返回业务数据即可，不要手动包装 `{ success, code, message, data }`。

DTO class 用于 `@Body()` / `@Param()` 时，必须保留运行时值导入，不要随手改成 `import type`。

## 8. 前端约束

核心原则：

- 页面负责组合。
- 组件负责渲染。
- hooks 负责状态、请求和副作用。
- api 层负责 HTTP 请求。
- utils 只放纯函数。
- 不为了拆而拆，也不要让单个 hook / 组件继续无限膨胀。

## 9. 安全与依赖

- API Key、token、数据库密码只能放环境变量。
- 前端不得保存模型平台 API Key。
- 新增环境变量时同步更新 `.env.example`。
- 不随意安装依赖；先确认现有依赖是否够用。
- 包管理器以锁文件为准，当前优先 `pnpm`。
- 不执行 `git reset --hard`、`git clean -fd` 等破坏性命令，除非用户明确要求。

## 10. 验证规则

按改动范围运行最小必要验证：

| 改动范围 | 推荐验证 |
| --- | --- |
| TypeScript / shared contracts | `pnpm typecheck` |
| 通用 lint | `pnpm lint` |
| 前端 | `pnpm --filter @agent/web typecheck`、`lint`、必要时 `build` |
| 后端 | `pnpm --filter @agent/api typecheck`、`lint` |
| Prisma | `pnpm prisma:generate`、`pnpm exec prisma validate` |

无法运行验证时，最终回复和必要的 docs 记录都要说明原因。

## 11. 正式任务的 docs 同步规则

只有正式 Issue 工作流或用户明确要求记录项目状态时，才按下面规则同步 docs：

| 情况 | 需要更新 |
| --- | --- |
| 实现阶段的 checklist / 验证证据 | 对应 `docs/tasks/**`，记录“已实现、待验收” |
| 阶段状态变化 | `docs/roadmap.md` 和 `docs/tasks/README.md` |
| 完成阶段 | 将任务精简归档到 `docs/tasks/completed/` |
| 重要架构决策或提交上下文 | `docs/work-log.md` |
| 只是小修 typo / 样式微调 | 可不更新 docs，commit 说明即可 |

原则：

- 不再向 `docs/development-task-plan.md` 写新任务。
- 不把研究长文写进 `docs/tasks/`。
- `work-log` 只写 commit 级事实，保持简洁。
- 阶段状态变化、Completed 和归档只在 GPT 验收且用户明确确认后写入。
- 如果 docs 更新范围明确，可以在 Issue workflow 内直接更新；如果范围不确定，先问用户。
