# AGENTS.md

## codex 必须遵守的规则!
- DO NOT send optional commentary ！！！！

本文件只在使用 Codex + GPT 时生效：GPT 负责讨论、规划、建 Issue 与验收，Codex 负责本地实现。使用 Claude 时以 `CLAUDE.md` 为准。两份文件中与工具无关的章节（项目定位、沟通、状态与入口、目录、架构原则、NestJS / 前端 / 安全 / 验证 / docs 规则）必须保持一致，改一处必须同步另一处；只有「工作方式」一节按各自工具编写。

## 1. 项目定位

从零手写的 TypeScript Agent Runtime：NestJS API + Vue Web / Admin + Prisma / PostgreSQL / pgvector，不依赖 LangChain / LangGraph / workflow 引擎。Phase 1-8 已完成：流式对话、AgentRun / AgentStep 编排、Tool Calling、Context Engineering、Grounded Retrieval 与服务端校验的引用、Admin 可观测性。

2026-09-05 定案的方向：

- 作品就是 runtime 本身，不再为它寻找产品域；第一个用户是用户自己。
- 目标是三样：运行层的技术深度、真实使用留下的问题记录、公开的设计笔记。求职叙事是「一个自己每天用、被真实使用打磨过的 agent runtime」。
- 参照物两个：OpenAI Codex（`docs/research/codex-reference/`）和 DeepSeek Harness（TypeScript，`docs/research/README.md` 有入口）。参照只用于对比取舍，不照抄。
- 当前能力缺口四块：Human-in-the-loop / 审批、Durable Execution / resume 与 replay、长期 Memory、成本与延迟。子系统只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时才立项，不因为「成熟项目有」就做。

Codex + GPT 模式下的角色：GPT 是讨论对手、任务规划者、Issue 创建者和 PR 验收者，并可在用户明确授权后处理 docs-only 收口、Draft 转 Ready、远程合并；Codex 按正式 Issue 在本地实现、验证并创建 Draft PR。

## 2. 用户与沟通

用户是 4 年前端（Vue / Nuxt / TS），后端按 NestJS 够用深度掌握，Phase 1-8 全程参与，不需要入门式解释和前端类比。

- 始终中文。代码标识符、命令、日志、错误信息、协议字段、文件名保持原文。
- 默认 TypeScript / NestJS / Vue；不默认 Python、Rust。
- 讲 agent 设计必须对照业界真实实现（Claude Code、Codex、DeepSeek Harness、OpenClaw、OpenAI Agents SDK、LangGraph），说清「他们怎么做、我们为什么一样或不一样」，不空谈概念。
- 澄清或拷问一轮最多 2 个问题，一句话问、一句话给推荐。
- 方向、方案、Issue 先讨论，用户点头后才写正式文档或建 Issue；讨论期间只给观点和草稿。
- 直接给结论和取舍，不做空泛鼓励，不取悦。
- 应用的 dev server（`pnpm dev` 等）由用户自己启动；数据库容器等基础设施准备不受此限。

## 3. 当前状态与文档入口

| 文档 | 用途 |
| --- | --- |
| `docs/README.md` | 文档总入口与当前状态 |
| `docs/roadmap.md` | 阶段路线与方向 |
| `docs/tasks/README.md` | 任务看板，Active / Completed / 放弃 以这里为准 |
| `docs/tasks/_template.tdd.md` | 新任务模板 |
| `docs/research/README.md` | 研究入口：codex-reference、DeepSeek Harness、学习方法 |
| `docs/research/learning-roadmap/learning-method.md` | 每个子系统的七步法与阶段产物 |
| `docs/development-workflow.md` | GPT + Codex 双角色完整流程，本文件保存触发规则和硬约束 |
| `docs/work-log.md` | 已发生事实 |
| `docs/tasks/completed/` | 已完成阶段归档 |

`docs/development-task-plan.md` 只保留为旧入口兼容，不写新任务。

当前状态：Phase 1-8 Completed 并归档；当前阶段为源码阅读，范围是 Phase 8 链路、codex-reference 中的 durability-recovery 与 safety-permission、DeepSeek Harness 的 session 与 interaction；无 Active Task；翻译质检站方向已放弃，A-1 / A-2 代码保留在 master，不再推进；下一批候选子系统为 session 事件流与 replay、审批门、compaction、定时任务，候选不等于 Active；Admin Task 4 保持 Planned。

## 4. 关键目录

| 目录 | 用途 |
| --- | --- |
| `apps/web/src/` | Vue 前台页面、组件、hooks、API 和状态 |
| `apps/admin/` | 运维控制台：Run Trace、Context / Retrieval Inspector、Overview |
| `apps/api/src/` | NestJS API、业务模块和应用入口 |
| `apps/api/src/agent-runtime/` | Agent Run 编排与运行记录 |
| `apps/api/src/llm/` | 模型调用、provider adapter 和模型流事件 |
| `apps/api/src/seo/` | SEO Agent 业务入口、上下文与协议适配 |
| `packages/contracts/` | 前后端共享协议与类型 |
| `prisma/` | schema、migration、fixtures 和 seed |
| `docs/tasks/` | 当前任务、阶段入口和已完成归档 |
| `docs/research/` | 参照物研究、学习方法、设计笔记与复盘 |

修改代码前先确认：`docs/tasks/README.md` 当前状态；相邻 service / controller / hook / component / utils / contract 能否复用；是否涉及 Prisma schema、contracts、前后端协议或 docs 同步。

## 5. 工作方式：GPT + Codex 双角色流程

本项目在此模式下由 Codex 本地执行、GPT 远程受托收口。正式功能默认由 Codex 按 Issue 实现，以用户本轮明确指令为准。完整流程见 `docs/development-workflow.md`。

| 用户意图 | 默认执行方式 |
| --- | --- |
| “完成 Issue #N”“读取 Issue #N 并实现” | `.codex/skills/github-issue-workflow` |
| “处理 PR #N 的 Review” | `.codex/skills/github-pr-review-fix` |
| “创建 Issue / 规划任务” | GPT 创建 Issue 与任务专属 Clarification Gate Prompt |
| “把设计笔记 / 技术方案 / 总结写入 docs” | GPT 可更新 `docs/research/**` 或合适 docs；用户明确授权时可直接写入 `master` |
| “GPT 已确认验收通过，我也确认，请收口” | GPT 或用户指定的 Codex 更新正式 docs 状态 |
| “转 Ready 并合并 / 合并 PR #N” | 只有用户明确授权后，GPT 或 Codex 才执行 Ready 转换与合并 |

其他讨论、源码阅读、inspection-only、本地实验和小改动默认自由进行，不自动切任务分支、commit、push、创建 PR 或更新任务状态。用户可以在本次指令中扩大或缩小流程。

硬性规则：

- `docs/tasks/**` 是任务与阶段状态的事实来源；Issue 保存实现规格、验收标准和澄清决策。
- 正式代码任务必须先创建 Issue，并使用独立任务分支和 PR，不直接在 `master` 上实现、提交或推送。
- 一个 Issue / PR 只完成一个任务单元；Clarification Gate 为 `READY` 后才能进入实现。
- 正式代码任务在暂存之后、commit 之前，必须显式调用 `$review-agent` 审暂存区 diff；确认为真问题的 finding 自行修复并入本次提交，不为技术判断等待用户确认，只有缺少密钥、权限、登录等授权类前提时才中断询问；`P0` / `P1` 必须给出明确结论，无法复现、超出 Issue 范围或与已确认规格冲突的不修但要说明，复审最多 2 轮后停止并记录剩余问题。findings 处理结果写入 PR 描述；docs-only 改动跳过。该自审不替代 PR 创建后的 Codex Review 和 GPT 技术验收。
- 正式 Issue 实现并完成必要验证后，默认创建 **Draft PR**；Codex 最多记录“实施状态：已实现 / 验收状态：待验收”，不得自行标记 Completed。
- Draft PR 可以接受 Codex Review 和 GPT 技术验收；**Draft 不代表实现未完成**。
- Ready 是用户明确授权后的发布 / 合并前状态，不是开始 Review 的前置条件。只有 GPT 技术验收通过、用户明确确认验收，并且用户明确授权转 Ready / 合并后，才允许将 Draft 转 Ready。
- 验收确认、docs 状态收口、Draft 转 Ready、合并和分支清理是不同动作；用户可以在同一句指令中一起授权，但不得自行推导。
- 只有 GPT 给出验收通过结论且用户明确确认后，才能把任务写成已通过 / Completed；Phase 是否 Completed 还必须满足该阶段自己的完成条件。
- 用户明确授权后，GPT 可以直接更新允许范围内的 docs-only 状态并提交 `master`，无需为纯文档状态同步单独创建 Issue / PR。
- 用户明确授权后，GPT 可以远程转 Ready、合并 PR、关闭放弃 PR、删除远程分支；本地 `master` 同步和本地分支清理由用户或本地 Codex 处理。
- 正式 GitHub 交付前必须先用 `gh auth status --hostname github.com` 和 `git push --dry-run origin HEAD` 预检凭据，且不得输出 token。若认证失效、凭据缺失、权限不足或 dry-run 因凭据失败，必须立即停止当前任务并告知用户；不得自行改用 GitHub API、Connector 或手工上传 blob / tree / commit / ref 绕过失败。
- Review 默认先解释再处理；finding 与最新 Issue 决策或项目规范冲突时，不得为了“通过 Review”反向违反已确认规格，应说明冲突并按事实来源解决。
- 当前不把 GitHub Actions 作为必需环节；以与 Task 匹配的本地验证、PR diff、Codex Review 和 GPT 验收为主要质量证据。
- 用户明确授权“更新 docs 并写入 master”“直接改 docs”“收口任务状态”等 docs-only 操作时，可以绕过 Issue / PR；业务功能、API / contracts、数据库、Agent Runtime、Streaming、Tool Calling、依赖、环境、安全或权限变更仍禁止直接写 `master`。

## 6. 架构原则

分层：

```txt
Controller -> Service -> AgentRuntime -> LLMService / ToolRegistry -> Prisma
```

Runtime 不变量：

- `Conversation` 是长期会话；`Message` 是用户可见消息；`AgentRun` 是一次用户输入触发的运行；`AgentStep` 是系统执行过程，不是模型真实 chain-of-thought。
- UI message ≠ model message ≠ runtime event ≠ 持久化轨迹，各自独立契约。
- delta 不等于持久化事实。
- model-visible context 通过独立 Context boundary 维护，不回填 UI `Message`。
- 模型看到的必须能从持久化记录重建（model-visible ⟺ logged），这是 resume / replay 的前提。
- 模型输出不可信：工具名、参数、引用 key 先校验再执行；检索正文按 untrusted data 隔离注入。
- 终态所有权：晚到的 Abort / deadline / DB 结果不能覆盖已确立终态；COMMIT 结果不确定时如实暴露。

小步可运行：先最小功能，再封装可复用边界；不为想象中的扩展建抽象。

不引入：Multi-agent、LangGraph / workflow engine、MCP marketplace、本地模型部署、微调。

后置（作为 harness 候选子系统，立项前不做）：OS sandbox、并行 Tool Call、Memory、MCP。

## 7. NestJS 约束

修改 Controller 前先检查 `apps/api/src/common/bootstrap/register-app-globals.ts`。

普通 Controller 不要重复实现全局能力：

- DTO 校验交给全局 `createAppValidationPipe()`。
- 成功响应包装交给 `ResponseTransformInterceptor`。
- 异常格式交给 `AllExceptionsFilter`。

Controller 返回业务数据即可，不要手动包装 `{ success, code, message, data }`。

DTO class 用于 `@Body()` / `@Param()` 时，必须保留运行时值导入，不要随手改成 `import type`。

## 8. 前端约束

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

| 情况 | 需要更新 |
| --- | --- |
| 设计对比、学习笔记、复盘 | `docs/research/**` |
| Issue 合并后 | 对应 `docs/tasks/**` 状态、`docs/roadmap.md`、`docs/work-log.md` 一条事实 |
| 阶段完成 | 精简归档到 `docs/tasks/completed/`，更新 `docs/README.md` 与 `docs/roadmap.md` |
| 方向或协作规则变化 | `CLAUDE.md`、`AGENTS.md` 共用章节同步，`docs/work-log.md` 一条事实 |
| 小修 typo / 样式微调 | 可不更新 docs，commit 说明即可 |

原则：

- `work-log` 只写真实已发生事实，保持简洁。
- 不把计划写成已完成事实；候选子系统不写成 Active。
- 不向 `docs/development-task-plan.md` 写新任务；不把研究长文写进 `docs/tasks/`。
- docs 更新范围不确定时先确认边界。
