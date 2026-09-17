# Tasks

本目录是正式任务状态的事实来源。规格、验收标准与决策记录在 GitHub Issue；已完成任务与阶段的详细记录在 [`completed/`](./completed/)、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Active Agent Task：无
Next：#115 模型调用重试（前置 #120 / #124 已于 2026-09-17 合并）
Planned：#116 同轮文本 + 多 Tool Call → #117 Responses API adapter → web_fetch（R0 后、R2 前）
候选子系统：session 事件流与 replay、审批门、compaction、定时任务（未立 Issue）
Admin Task 4：Planned
```

## 看板

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| #118 删除死代码、单实现抽象与自校验 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #121 于 2026-09-17 基于最新 head 逐条验收 AC-01～AC-06 PASS 并合并（+327 / −761，无新增文件）：删 `receive_user_message` Step 写入、`abortStep`、`ToolRegistryService.require / listDefinitions`、`ContextBudgetExceededError.stage`、`SeoContextBuilder`、`AgentRunConfigurationService`、`ToolExecutionContext.executionAttempt`、`ModelContext.forSampling` 与 snapshot 明细项，`TokenEstimator` 改 interface；`tool-step-summary`、Admin 读取字段与 `tool-evidence` 校验按 Issue 保留。学习环节按 Issue 决策记录豁免 |
| #119 历史裁剪合一 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #122 于 2026-09-17 基于最新 head `bcf76b0` 逐条验收 AC-01～AC-06 PASS 并合并：删 `InitialContextSelectionService` 分页与批内二分，历史一次 `findMany({ take: hardLimit })`，首轮由 planner `excludeOldestHistory` 裁剪；`initialContext` 取裁剪前值（`excludedReason` 只剩 `candidate_cap`）、`contextPlan` 记删减数；`buildModelMessages` 改 `instructions`；删 `SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE`。真实 tokenizer 差分旧算法 68 = planner 68；本机运行服务两轮真实对话 + Admin 投影冒烟通过。学习环节按 Issue 决策记录豁免 |
| #120 抽出 `packages/ai` | Completed | 实施状态：已实现 / 验收状态：已通过。PR #123 于 2026-09-17 基于最新 head `5840d98` 逐条验收 AC-01～AC-05 PASS 并合并：新建 `@agent/ai`（零 Nest、零 Prisma），`git mv` 迁入 `OpenAICompatibleClient`、流适配、tool-call 累加、raw capture、`llm.types` / `llm.errors` / `model-*.types` / `model-profiles`、`resolveLLMRuntimeConfig` 与 6 个测试文件，`JsonSchemaProperty` / `JsonObjectSchema` 同迁；client 去装饰器改收 `LLMRuntimeConfig` 纯对象，`LlmModule` 用 `useFactory` 装配；`apps/api/src/llm/` 只剩四个壳；七个 build 脚本加 ai build，`test:llm-config` / `test:model-stream` 按归属拆分，包内 `test` 先建 contracts；`index.ts` 只导出 api 实际引用。验证：删三处 dist 后 typecheck 6/6、api build 通过，`@agent/ai test` 37/37（无 `DATABASE_URL`），api 13 个不依赖数据库的 `test:*` 全绿；根 lint 仅 11 个 `docs/research` 文件为既有基线失败（与 master 逐文件一致）；AC-04 走本机 3002 dev 服务两次真实对话（start → delta → done、delta 拼接等于最终内容、Admin Run COMPLETED），`smoke:grounded-answer` 因隔离库 public schema 未跑 migration（P2021）无法执行。`/code-review high` 两轮 11 条：修 7 条、按 Issue 范围不修 4 条。学习环节按 Issue 决策记录豁免 |
| #124 `packages/ai` 目录按 Pi 分层整理 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #125 于 2026-09-17 基于最新 head `5e6134f` 逐条验收 AC-01～AC-06 PASS 并合并：根目录收成 `types.ts` / `errors.ts` / `config.ts` / `deepseek.ts`，`clients/` 改 `api/` 并按 `openai-completions*` 命名，12 个 `git mv`（11 个 R094～R100；`deepseek.ts` 因按范围第 3 条并入 DeepSeek REST 类型为 R073，AC-02 的 ≥ 90% 对该文件与范围第 3 条算术上不相容，PR 已说明），四个 `*.types.ts` 合并为 `types.ts`，`index.ts` 导出集合 34 个符号不变，零运行时行为变化；另修正 5 处研究文档旧路径。验证：删 dist 后 `@agent/ai` typecheck / build 通过、test 37/37，全 workspace typecheck 6/6，api typecheck / lint 通过。`/code-review medium` 1 条 Low（文档行号锚点）已修。学习环节按 Issue 决策记录豁免 |
| #115 模型调用重试与 Loop 默认上限 | Planned | SDK 内置重试（首个响应头之前）、`LLM_REQUEST_MAX_RETRIES`、采样 / 工具默认上限 10 / 8；在 `packages/ai` 内实现；前置 #120 |
| #116 同轮文本 + 多 Tool Call | Planned | content 先于 tool_calls、多个 tool_calls 顺序执行、上限解耦、截断参数回喂；前置 #115 |
| #117 Responses API adapter | Planned | `LLM_WIRE_API` 切换 chat / responses，第二个 adapter 接同一契约；前置 #116 |
| `web_fetch` 第一个真实工具 | Planned | 只读、SSRF 防护、untrusted observation；前置 #115–117，范围见 [pi-reference roadmap](../research/pi-reference/roadmap.md) |
| Admin Console Task 4 | Planned | Auth / RBAC；触发条件见 [roadmap.md](../roadmap.md) 后置清单 |
| 已完成 | Completed | Phase 2–8、横向任务 #92 / #94 / #98 / #101–#104、Admin Console Task 0–3 与 Enhancement 1–3，归档在 [completed/](./completed/) |
| 翻译质检站 #109 / #111 | 已删除 | 2026-09-05 经 #113 / PR #114 删除全部代码与数据模型 |

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 已记录方向或已建 Issue，但前置任务或启动条件尚未满足 |
| Next | 已确认是下一项正式任务，Issue 已创建但未开工 |
| Active | Issue 已创建，正在实现或待验收；一次只有一个 |
| Gated | 只有客观触发条件满足后才重新讨论 |
| 已放弃 / 已删除 | 方向放弃；代码保留或删除按看板记录 |
| Completed | 已实现且验收通过：PR 逐条验收 PASS 并合并 |

## 规则

- 一个 Issue 只对应一个任务单元；Planned / Next 不能替代正式 Issue；
- Issue 建立前不得修改正式代码；Issue 实质性变化后先更新 Issue 再继续；
- 实现后先写「已实现、待验收」，验收 PASS 后才写「已通过」；
- 只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时建 Issue；Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不自动进入实现；
- 流程、Issue 模板与任务状态定义见 [`../workflow.md`](../workflow.md)。
