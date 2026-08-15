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

Codex 应作为 Agent 应用开发学习搭档，负责按正式 Issue 实现、验证和创建 Draft PR，并在关键设计点解释为什么这样做。GPT 是学习导师、任务规划者、Issue 创建者和 PR 验收者，并可在用户明确授权后处理 docs-only 收口、Draft 转 Ready、远程合并等 GitHub 收尾动作。

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
| `docs/development-workflow.md` | GPT、Issue、Codex、PR、Review、学习 docs 与受托执行规范 |
| `docs/tasks/completed/phase-06-bounded-agent-loop.md` | 已完成 Phase 6 的最终归档入口 |
| `docs/tasks/completed/phase-07-context-engineering.md` | 已完成 Phase 7 的最终归档入口 |
| `docs/tasks/completed/` | 已完成阶段归档 |
| `docs/research/` | 研究资料、学习路线、技术方案和复盘沉淀 |
| `docs/work-log.md` | 近期真实推进与收口记录 |

`docs/development-task-plan.md` 只保留为旧入口兼容，不再写入新任务。

当前 Agent 主线状态：Phase 1-7 已 Completed；Phase 8 保持 Active，Task 0、Task 1、Task 2A 已 Completed；Task 2B 为 Next、Task 3 为 Planned；当前无 Active Agent Task；Minimal Compaction 继续保持 Gated。

## 4. 关键目录与任务入口

修改代码前，先快速确认相关上下文：

- 先看 `docs/tasks/README.md` 判断当前 Active / Next 任务。
- 再阅读当前阶段目录下的具体任务文档；如果当前无 Active Task，不得因为某个 Task 为 Next 就自行实现，必须先有正式 Issue 并通过 Clarification Gate。
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
| `docs/research/` | 研究资料、学习路线、技术方案和复盘沉淀 |

## 5. 工作方式与 Skill 触发

本项目同时支持 Codex 本地执行和 GPT 远程受托收口。正式功能默认由 Codex 按 Issue 实现，以用户本轮明确指令为准。

| 用户意图 | 默认执行方式 |
| --- | --- |
| “完成 Issue #N”“读取 Issue #N 并实现” | `.codex/skills/github-issue-workflow` |
| “处理 PR #N 的 Review” | `.codex/skills/github-pr-review-fix` |
| “创建 Issue / 规划任务” | GPT 创建 Issue 与任务专属 Clarification Gate Prompt |
| “把学习路线 / 技术方案 / 总结写入 docs” | GPT 可更新 `docs/research/**` 或合适 docs；用户明确授权时可直接写入 `master` |
| “GPT 已确认验收通过，我也确认，请收口” | GPT 或用户指定的 Codex 更新正式 docs 状态 |
| “转 Ready 并合并 / 合并 PR #N” | 只有用户明确授权后，GPT 或 Codex 才执行 Ready 转换与合并 |

其他学习、讨论、inspection-only、本地实验和小改动默认自由进行，不自动切任务分支、commit、push、创建 PR 或更新任务状态。用户可以在本次指令中扩大或缩小流程。

硬性规则：

- `docs/tasks/**` 是任务与阶段状态的事实来源；Issue 保存实现规格、验收标准和澄清决策。
- 正式代码任务必须先创建 Issue，并使用独立任务分支和 PR，不直接在 `master` 上实现、提交或推送。
- 一个 Issue / PR 只完成一个任务单元；Clarification Gate 为 `READY` 后才能进入实现。
- 正式 Issue 实现并完成必要验证后，默认创建 **Draft PR**；Codex 最多记录“实施状态：已实现 / 验收状态：待验收”，不得自行标记 Completed。
- Draft PR 可以接受 Codex Review 和 GPT 技术验收；**Draft 不代表实现未完成**。
- Ready 是用户明确授权后的发布 / 合并前状态，不是开始 Review 的前置条件。只有 GPT 技术验收通过、用户明确确认验收，并且用户明确授权转 Ready / 合并后，才允许将 Draft 转 Ready。
- 验收确认、docs 状态收口、Draft 转 Ready、合并和分支清理是不同动作；用户可以在同一句指令中一起授权，但不得自行推导。
- 只有 GPT 给出验收通过结论且用户明确确认后，才能把任务写成已通过 / Completed；Phase 是否 Completed 还必须满足该阶段自己的完成条件。
- 用户明确授权后，GPT 可以直接更新允许范围内的 docs-only 状态并提交 `master`，无需为纯文档状态同步单独创建 Issue / PR。
- 用户明确授权后，GPT 可以远程转 Ready、合并 PR、关闭放弃 PR、删除远程分支；本地 `master` 同步和本地分支清理由用户或本地 Codex 处理。
- 正式 GitHub 交付前必须先用 `gh auth status --hostname github.com` 和 `git push --dry-run origin HEAD` 预检凭据，且不得输出 token。若认证失效、凭据缺失、权限不足或 dry-run 因凭据失败，必须立即停止当前任务并告知用户；不得自行改用 GitHub API、Connector 或手工上传 blob / tree / commit / ref 绕过失败。只有用户修复凭据或在知情后明确授权替代方案，才可继续。
- Review 默认先解释再处理；finding 与最新 Issue 决策或项目规范冲突时，不得为了“通过 Review”反向违反已确认规格，应说明冲突并按事实来源解决。
- 当前不把 GitHub Actions 作为必需环节；以与 Task 匹配的本地验证、PR diff、Codex Review 和 GPT 验收为主要质量证据。
- 用户明确授权“更新 docs 并写入 master”“直接改 docs”“收口任务状态”等 docs-only 操作时，可以绕过 Issue / PR；业务功能、API / contracts、数据库、Agent Runtime、Streaming、Tool Calling、依赖、环境、安全或权限变更仍禁止直接写 `master`。

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

当前 Runtime 尤其注意：

- `Conversation` 是长期会话。
- `Message` 是用户可见消息。
- `AgentRun` 是一次用户输入触发的运行。
- `AgentStep` 是系统执行过程，不是模型真实 chain-of-thought。
- UI message 不等于 model message。
- delta 不等于持久化事实。
- model-visible context 应通过独立 Context boundary 维护，不能为了方便回填进 UI `Message`。

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
| docs-only | `git diff --check`，必要时手动检查链接和结构 |

无法运行验证时，最终回复和必要的 docs 记录都要说明原因。

## 11. docs 同步规则

只有正式 Issue 工作流、学习 docs 沉淀或用户明确要求记录项目状态时，才按下面规则同步 docs：

| 情况 | 需要更新 |
| --- | --- |
| 学习路线、技术方案、阶段总结、项目复盘 | 优先写入 `docs/research/**` |
| 实现完成且验证通过后的 checklist / 验证证据 | 对应 `docs/tasks/**`，记录“已实现、待验收” |
| 阶段状态变化 | `docs/roadmap.md` 和 `docs/tasks/README.md` |
| 用户确认验收后的 Task 收口 | 对应 `docs/tasks/**`、`docs/roadmap.md`，必要时更新 `docs/README.md` |
| 完成阶段 | 将任务精简归档到 `docs/tasks/completed/` |
| 重要架构决策、Review 决策或合并事实 | `docs/work-log.md` |
| 只是小修 typo / 样式微调 | 可不更新 docs，commit 说明即可 |

原则：

- 学习 docs 沉淀不强制创建 Issue；用户明确授权时，GPT 可直接提交允许范围内的 docs-only 变更到 `master`。
- 不再向 `docs/development-task-plan.md` 写新任务。
- 不把研究长文写进 `docs/tasks/`。
- 不把计划写成已完成事实。
- `work-log` 只写真实已发生事实，保持简洁。
- 阶段状态变化、Completed 和归档只在 GPT 验收且用户明确确认后写入。
- Task 完成后可以把下一项已确认的正式任务推进为 `Next`，但没有 Issue + Gate `READY` 时不得写成 `Active`。
- 如果 docs 更新范围明确，可以在当前授权内直接更新；如果范围不确定，先确认边界。