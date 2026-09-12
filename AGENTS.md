# AGENTS.md

本文件是仓库对 agent 工具的工具无关基线：任何在这个仓库里工作的工具都读它，项目定位、沟通、状态入口、目录、架构原则、安全、验证和 docs 规则只在这里维护一份。

工具专属差异（角色分工、触发语、自审命令、授权默认范围）不写进本文件，放在对应载体里：

| 载体 | 适用 | 内容 |
| --- | --- | --- |
| 本文件 | 所有工具 | 工具无关基线 |
| `docs/development-workflow.md` | 多角色分工：规划 / 验收与本地实现分开 | 角色表、Clarification Gate、Issue 规格、触发语、授权边界 |
| `CLAUDE.md` | 单角色会话：讨论到收口在同一会话 | 单角色流程与该流程的授权默认范围 |

改本文件时只需确认两个载体是否仍然成立，不需要同步正文。

## 1. 项目定位

从零手写的 TypeScript Agent Runtime：NestJS API + Vue Web / Admin + Prisma / PostgreSQL / pgvector，不依赖 LangChain / LangGraph / workflow 引擎。Phase 1-8 已完成：流式对话、AgentRun / AgentStep 编排、Tool Calling、Context Engineering、Grounded Retrieval 与服务端校验的引用、Admin 可观测性。

2026-09-05 定案的方向：

- 作品就是 runtime 本身，不再为它寻找产品域；第一个用户是用户自己。
- 目标是三样：运行层的技术深度、真实使用留下的问题记录、公开的设计笔记。求职叙事是「一个自己每天用、被真实使用打磨过的 agent runtime」。
- 参照物两个：OpenAI Codex（`docs/research/codex-reference/`）和 DeepSeek Harness（TypeScript，`docs/research/README.md` 有入口）。参照只用于对比取舍，不照抄。
- 当前能力缺口四块：Human-in-the-loop / 审批、Durable Execution / resume 与 replay、长期 Memory、成本与延迟。子系统只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时才立项，不因为「成熟项目有」就做。

## 2. 用户与沟通

用户是 4 年前端（Vue / Nuxt / TS），后端按 NestJS 够用深度掌握，Phase 1-8 全程参与，不需要入门式解释和前端类比。

- 始终中文。代码标识符、命令、日志、错误信息、协议字段、文件名保持原文。
- 默认 TypeScript / NestJS / Vue；不默认 Python、Rust。
- 讲 agent 设计必须对照业界真实实现（Claude Code、Codex、DeepSeek Harness、OpenClaw、OpenAI Agents SDK、LangGraph），说清「他们怎么做、我们为什么一样或不一样」，不空谈概念。
- 只给必要信息：结论、取舍和证据；不补可选评论。
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
| `docs/development-workflow.md` | 多角色分工的完整流程：角色表、Clarification Gate、Issue 规格、触发语、授权边界 |
| `docs/work-log.md` | 已发生事实 |
| `docs/tasks/completed/` | 已完成阶段归档 |

`docs/development-task-plan.md` 只保留为旧入口兼容，不写新任务。

当前状态：Phase 1-8 Completed 并归档；当前阶段为源码阅读，范围是 Phase 8 链路、codex-reference 中的 durability-recovery 与 safety-permission、DeepSeek Harness 的 session 与 interaction；无 Active Task，Next 为 #115 → #116 → #117（已立 Issue、未开工）；翻译质检站已于 #113 删除；下一批候选子系统为 session 事件流与 replay、审批门、compaction、定时任务，候选不等于 Active；Admin Task 4 保持 Planned。

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

## 5. 工作方式：工具无关约束

流程形态和授权范围由用户本轮明确指令决定，具体差异见顶部载体表中的两个文件。以下约束对任何工具都成立：

- `docs/tasks/**` 是任务与阶段状态的事实来源；Issue 保存实现规格、验收标准和澄清决策。
- 正式代码任务先建 Issue，再走独立任务分支和 PR，不直接在 `master` 上实现、提交或推送。
- 一个 Issue / PR 只完成一个任务单元，不顺手推进后续任务。
- 暂存之后、commit 之前必须按该载体约定的 review 步骤审暂存区 diff：确认为真问题的 finding 自行修复并入本次提交，不为技术判断等待用户确认；无法复现、超出范围或与已确认规格冲突的不修但要说明；复审最多 2 轮后停止并记录剩余问题。docs-only 改动跳过。
- review 在本地完成，通过后才创建 PR；PR 是验收载体，不用来收集 review。PR 创建即为 Ready，只有实现未完成、验证失败或受阻才用 Draft；云端自动 Review 是可选输入，不阻塞交付。
- 不因技术意见取舍打断用户；只在缺少密钥、权限、登录等授权类前提，或出现会改变实现方向的规格冲突时中断询问。
- 验收必须基于 PR 最新 head，逐条核对验收标准与真实验证输出；「测试命令成功」或「代码看起来合理」不单独构成验收。
- 验收确认、docs 状态收口、合并和分支清理是不同动作，各自需要用户明确授权，不得自行推导；用户可以在同一句指令中一并授权，各流程的默认授权范围见顶部载体表。任何工具都不得自行把任务标成 Completed；Phase 是否 Completed 还必须满足该阶段自己的完成条件。
- Review finding 与最新 Issue 决策或项目规范冲突时，不为「通过 Review」反向违反已确认规格，应说明冲突并按事实来源解决。
- 正式 GitHub 交付前必须先用 `gh auth status --hostname github.com` 和 `git push --dry-run origin HEAD` 预检凭据，且不得输出 token。若认证失效、凭据缺失、权限不足或 dry-run 因凭据失败，必须立即停止当前任务并告知用户；不得自行改用 GitHub API、Connector 或手工上传 blob / tree / commit / ref 绕过失败。
- 当前不把 GitHub Actions 作为必需环节；commit 前的本地自审（本地验证 + review 结论）是唯一必需的检查，PR diff、云端 Review 和验收记录是补充证据。
- 用户明确授权「更新 docs 并写入 master」「直接改 docs」「收口任务状态」等 docs-only 操作时，可以绕过 Issue / PR；业务功能、API / contracts、数据库、Agent Runtime、Streaming、Tool Calling、依赖、环境、安全或权限变更仍禁止直接写 `master`。
- 讨论、源码阅读、inspection-only、本地实验和小改动默认自由进行，不自动切任务分支、commit、push、创建 PR 或更新任务状态。

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
| 协作规则变化 | 工具无关内容改 `AGENTS.md`；工具专属内容改对应载体；`docs/work-log.md` 一条事实 |
| 小修 typo / 样式微调 | 可不更新 docs，commit 说明即可 |

原则：

- `work-log` 只写真实已发生事实，保持简洁。
- 不把计划写成已完成事实；候选子系统不写成 Active。
- 不向 `docs/development-task-plan.md` 写新任务；不把研究长文写进 `docs/tasks/`。
- docs 更新范围不确定时先确认边界。
