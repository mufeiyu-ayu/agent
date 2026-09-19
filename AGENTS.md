# AGENTS.md

本文件是仓库对 agent 工具的工具无关基线：任何在这个仓库里工作的工具都读它，项目定位、沟通、状态入口、目录、架构原则、安全、验证、docs 规则只在这里维护一份；协作流程在 `docs/workflow.md`，由本文件导入。正在读它的工具就是「你」，不区分是哪一个。

随工具变化的只有三样：review 命令、skill 路径、分支前缀。它们不写进本文件，放在该工具自己的适配文件里：

| 载体 | 适用 | 内容 |
| --- | --- | --- |
| 本文件 | 所有工具 | 工具无关基线 |
| `docs/workflow.md` | 所有工具 | 单角色流程、学习环节、硬约束、Issue 模板与任务状态；本文件用 `@docs/workflow.md` 导入，不解析 `@` 的工具在会话开始先读它 |
| 工具适配文件（Claude Code 为 `CLAUDE.md`，pi 为 `.pi/APPEND_SYSTEM.md`） | 该工具的会话 | review 命令、skill 路径、分支前缀 |

改本文件时只需确认另外两类载体是否仍然成立，不需要同步正文。

## 1. 项目定位

从零手写的 TypeScript Agent Runtime：NestJS API + Vue Web / Admin + Prisma / PostgreSQL / pgvector，不依赖 LangChain / LangGraph / workflow 引擎。Phase 1-8 已完成：流式对话、AgentRun / AgentStep 编排、Tool Calling、Context Engineering、Grounded Retrieval 与服务端校验的引用、Admin 可观测性。

**定案的方向**
- 2026-09-15：完成当前源码学习后，面向云端 Agent 产品演进，以 Pi 为主要架构与组织方式参照（`docs/research/pi-reference/`）；旧 Codex 调研、reference 与阶段路线已按用户要求删除。DeepSeek Harness 保留补充对照。参照素材供 AI 实现时查阅，用户不读 Pi 代码；参照用于对比取舍，不照抄；研究完成不代表重构已启动。
- 当前能力缺口四块：Human-in-the-loop / 审批、Durable Execution / resume 与 replay、长期 Memory、成本与延迟。子系统只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时才立项，不因为「成熟项目有」就做。

## 2. 用户与沟通

用户是 4 年前端（Vue / Nuxt / TS），后端按 NestJS 够用深度掌握，Phase 1-8 全程参与，不需要入门式解释和前端类比。

- 始终中文。代码标识符、命令、日志、错误信息、协议字段、文件名保持原文。
- 默认 TypeScript / NestJS / Vue；不默认 Python、Rust。
- 讲 agent 设计必须对照真实实现，当前优先 Pi（必要时补充 Claude Code、Codex、DeepSeek Harness、OpenClaw、OpenAI Agents SDK、LangGraph），说清「他们怎么做、我们为什么一样或不一样」，不空谈概念。
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
| `docs/research/README.md` | 研究入口：pi-reference、补充参照与参照实现方法 |
| `docs/research/pi-reference/learning-method.md` | 参照实现的六问与每步产物 |
| `docs/workflow.md` | 单角色流程、学习环节、硬约束与共用定义；`AGENTS.md` 自动导入 |
| `docs/work-log.md` | 已发生事实 |
| `docs/tasks/completed/` | 已完成阶段与任务的归档 |

当前状态：Phase 1-8 Completed 并归档；当前阶段为源码阅读，先完成当前项目链路学习，之后按 `docs/research/pi-reference/roadmap.md` 由 AI 参照 Pi 实现云端方向；无 Active Task，#118 / #119 / #120 / #124 已于 2026-09-17 合并，#126 / #127 / #115 已于 2026-09-18 合并，#116 / #134 已于 2026-09-19 合并（#134 去掉 SEO 产品命名，入口改为 `apps/api/src/chat/` 与 `/api/chat/stream`），Next 为 #135 → #136 → #137（2026-09-19 过度设计审计后立项；web_fetch 同日转 Gated；#117 已于 2026-09-18 关闭转 Gated）；翻译质检站已于 #113 删除；下一批候选子系统为 session 事件流与 replay、审批门、compaction、定时任务，候选不等于 Active；Admin Task 4 保持 Planned。

## 4. 关键目录

| 目录 | 用途 |
| --- | --- |
| `apps/web/src/` | Vue 前台页面、组件、hooks、API 和状态 |
| `apps/admin/` | 运维控制台：Run Trace、Context / Retrieval Inspector、Overview |
| `apps/api/src/` | NestJS API、业务模块和应用入口 |
| `apps/api/src/agent-runtime/` | Agent Run 编排与运行记录 |
| `apps/api/src/llm/` | LLM 的 Nest 壳：`LlmModule`、`LLMController`、`LLMService` 门面、`LLMRuntimeConfigService` |
| `apps/api/src/chat/` | Chat 业务入口：DTO 校验、系统提示词与 NDJSON 流协议适配 |
| `packages/ai/` | `@agent/ai`：模型客户端、OpenAI-compatible 流适配、模型类型 / 错误 / profile / 运行时配置解析；零 Nest、零 Prisma |
| `packages/contracts/` | 前后端共享协议与类型 |
| `prisma/` | schema、migration、fixtures 和 seed |
| `docs/tasks/` | 当前任务、阶段入口和已完成归档 |
| `docs/research/` | 参照物研究、参照实现方法、设计笔记与复盘 |

修改代码前先确认：`docs/tasks/README.md` 当前状态；相邻 service / controller / hook / component / utils / contract 能否复用；是否涉及 Prisma schema、contracts、前后端协议或 docs 同步。

## 5. 工作方式

协作流程、触发语、授权边界、学习环节与硬约束见导入的 `docs/workflow.md`：

@docs/workflow.md

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
| 协作规则变化 | 流程与硬约束改 `docs/workflow.md`，其余工具无关内容改 `AGENTS.md`；工具专属内容改对应载体；`docs/work-log.md` 一条事实 |
| 小修 typo / 样式微调 | 可不更新 docs，commit 说明即可 |

原则：

- `work-log` 只写真实已发生事实，保持简洁。
- 不把计划写成已完成事实；候选子系统不写成 Active。
- 不把研究长文写进 `docs/tasks/`。
- docs 更新范围不确定时先确认边界。
