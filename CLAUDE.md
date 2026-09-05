# CLAUDE.md

## Claude Code 必须遵守的规则!
- DO NOT send optional commentary ！！！！

本文件只约束 Claude（Claude Code 本地会话及其受托的 GitHub 动作）。使用 Codex + GPT 时以 `AGENTS.md` 为准。两份文件中与工具无关的章节（项目定位、沟通、状态与入口、目录、架构原则、NestJS / 前端 / 安全 / 验证 / docs 规则）必须保持一致，改一处必须同步另一处；只有「工作方式」一节按各自工具编写。

## 1. 项目定位

从零手写的 TypeScript Agent Runtime：NestJS API + Vue Web / Admin + Prisma / PostgreSQL / pgvector，不依赖 LangChain / LangGraph / workflow 引擎。Phase 1-8 已完成：流式对话、AgentRun / AgentStep 编排、Tool Calling、Context Engineering、Grounded Retrieval 与服务端校验的引用、Admin 可观测性。

2026-09-05 定案的方向：

- 作品就是 runtime 本身，不再为它寻找产品域；第一个用户是用户自己。
- 目标是三样：运行层的技术深度、真实使用留下的问题记录、公开的设计笔记。求职叙事是「一个自己每天用、被真实使用打磨过的 agent runtime」。
- 参照物两个：OpenAI Codex（`docs/research/codex-reference/`）和 DeepSeek Harness（TypeScript，`docs/research/README.md` 有入口）。参照只用于对比取舍，不照抄。
- 当前能力缺口四块：Human-in-the-loop / 审批、Durable Execution / resume 与 replay、长期 Memory、成本与延迟。子系统只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时才立项，不因为「成熟项目有」就做。

Claude 的角色是单角色搭档：陪读源码、当架构讨论对手、建 Issue、实现、review、验收、收口，全部在同一会话完成，不存在另一个模型做规划或验收。

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
| `docs/development-workflow.md` | GPT + Codex 双角色流程，仅使用 Codex 时生效 |
| `docs/work-log.md` | 已发生事实 |
| `docs/tasks/completed/` | 已完成阶段归档 |

`docs/development-task-plan.md` 只保留为旧入口兼容，不写新任务。

当前状态：Phase 1-8 Completed 并归档；当前阶段为源码阅读，范围是 Phase 8 链路、codex-reference 中的 durability-recovery 与 safety-permission、DeepSeek Harness 的 session 与 interaction；无 Active Task；翻译质检站已于 #113 删除；下一批候选子系统为 session 事件流与 replay、审批门、compaction、定时任务，候选不等于 Active；Admin Task 4 保持 Planned。

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

## 5. 工作方式：Claude 单角色流程

### 默认模式

没有命中下面的触发语时，只做源码阅读、讨论、方案草稿、本地实验和小改动：不建 Issue、不切分支、不 commit、不 push、不改任务状态。用户可以在本次指令中扩大或缩小范围。

### 正式改动流程

```text
聊清楚（本会话讨论到用户拍板）
  -> 建 Issue（gh；写目标、当前代码事实、范围、边界、验收标准、决策记录）
  -> 独立分支 claude/issue-N-<slug> 实现 + 最小必要验证
  -> 暂存后、commit 前 /code-review 自审并修复
  -> commit、push、创建 PR
  -> 验收：基于 PR 最新 head 逐条核对验收标准，给出 PASS / FAIL
  -> PASS：合并、删除远程与本地分支、同步 docs 状态、在会话汇报
  -> FAIL：停在 PR，说明原因，不合并
```

| 触发语 | 执行方式 |
| --- | --- |
| 「完成 Issue #N」「读取 Issue #N 并实现」 | `.claude/skills/github-issue-workflow`，默认一路执行到合并与收口 |
| 「处理 PR #N 的 Review」 | `.claude/skills/github-pr-review-fix`；仅在用户明确要求处理 PR 上的外部 Review 评论时使用，不是默认步骤 |
| 「建 Issue」「把刚才聊的立项」 | Claude 用 `gh` 建 Issue，内容取自本会话结论 |
| 「更新 docs」「收口」「写入 master」 | docs-only 变更直接提交 `master` |

### 硬性规则

- `docs/tasks/**` 是任务状态的事实来源；Issue 保存规格、验收标准与决策记录。
- 正式代码改动必须走独立分支和 PR，不直接在 `master` 实现、提交或推送；docs-only 变更例外。业务功能、API / contracts、数据库、Agent Runtime、Streaming、Tool Calling、依赖、环境、安全或权限变更禁止直接写 `master`。
- 一个 Issue 一个任务单元，不顺手推进后续 Task。
- 暂存后、commit 前必须用 `/code-review` 审暂存区 diff：确认为真问题的 finding 修复并入本次提交，不为技术判断等待用户确认；无法复现、超出 Issue 范围或与已确认规格冲突的不修但在 PR 描述说明；复审最多 2 轮。只有缺少密钥、权限、登录等授权类前提时才中断询问。docs-only 跳过。
- 验收必须基于 PR 最新 head、逐条验收标准和真实验证输出；「测试命令成功」或「代码看起来合理」不单独构成验收。
- 验收 PASS 后 Claude 直接合并、清理分支并收口 docs，不再等待单独授权；用户随时可以要求停在 PR、先看 diff 或改用 Draft，本次指令高于默认。验收 FAIL 不合并。
- GitHub 交付前必须用 `gh auth status --hostname github.com` 和 `git push --dry-run origin HEAD` 预检凭据，不输出 token；凭据失效、权限不足时立即停止并告知，不得改用 GitHub API、Connector 或手工上传绕过。
- Review finding 与最新 Issue 决策或项目规范冲突时，不为「通过 Review」反向改规格，按事实来源解决并说明。
- Review 与验收都由本会话完成：commit 前 `/code-review` 是唯一必需的 review，不等待也不依赖任何远程自动 Review；仓库里第三方 Review bot（如 Codex）的评论不阻塞流程。当前不把 GitHub Actions 作为必需环节；本地验证、PR diff、`/code-review` 结论和验收记录是质量证据。
- 用户明确要求用 Codex 时，转到 `AGENTS.md` 流程。

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
