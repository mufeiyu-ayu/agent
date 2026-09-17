# Tasks

本目录是正式任务状态的事实来源。规格、验收标准与决策记录在 GitHub Issue；已完成任务与阶段的详细记录在 [`completed/`](./completed/)、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Active Agent Task：#120 抽出 packages/ai（实施状态：已实现 / 验收状态：待验收）
Next：#115 模型调用重试（前置 #120）
Planned：#116 同轮文本 + 多 Tool Call → #117 Responses API adapter → web_fetch（R0 后、R2 前）
候选子系统：session 事件流与 replay、审批门、compaction、定时任务（未立 Issue）
Admin Task 4：Planned
```

## 看板

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| #118 删除死代码、单实现抽象与自校验 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #121 于 2026-09-17 基于最新 head 逐条验收 AC-01～AC-06 PASS 并合并（+327 / −761，无新增文件）：删 `receive_user_message` Step 写入、`abortStep`、`ToolRegistryService.require / listDefinitions`、`ContextBudgetExceededError.stage`、`SeoContextBuilder`、`AgentRunConfigurationService`、`ToolExecutionContext.executionAttempt`、`ModelContext.forSampling` 与 snapshot 明细项，`TokenEstimator` 改 interface；`tool-step-summary`、Admin 读取字段与 `tool-evidence` 校验按 Issue 保留。学习环节按 Issue 决策记录豁免 |
| #119 历史裁剪合一 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #122 于 2026-09-17 基于最新 head `bcf76b0` 逐条验收 AC-01～AC-06 PASS 并合并：删 `InitialContextSelectionService` 分页与批内二分，历史一次 `findMany({ take: hardLimit })`，首轮由 planner `excludeOldestHistory` 裁剪；`initialContext` 取裁剪前值（`excludedReason` 只剩 `candidate_cap`）、`contextPlan` 记删减数；`buildModelMessages` 改 `instructions`；删 `SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE`。真实 tokenizer 差分旧算法 68 = planner 68；本机运行服务两轮真实对话 + Admin 投影冒烟通过。学习环节按 Issue 决策记录豁免 |
| #120 抽出 `packages/ai` | Active | 实施状态：已实现 / 验收状态：待验收。分支 `claude/issue-120-extract-packages-ai`：新建 `@agent/ai`（零 Nest、零 Prisma），`git mv` 迁入 client / 流适配 / 类型 / 错误 / profile / `resolveLLMRuntimeConfig` 与对应测试，`JsonSchemaProperty` / `JsonObjectSchema` 同迁；`OpenAICompatibleClient` 去装饰器改收 `LLMRuntimeConfig` 纯对象，`LlmModule` 用 `useFactory` 装配；`apps/api/src/llm/` 只剩四个壳。验证：删三处 dist 后 `pnpm typecheck` 6/6 通过、改动的 ts / json / md 文件 eslint 通过（根 lint 的 11 个失败文件均为 docs/research 既有基线，其中 `model-telemetry-evals.md` 本次只改 4 处链接路径、错误集合与 master 完全一致）、`pnpm --filter @agent/api build` 通过、`@agent/ai test` 37/37、api 13 个不依赖数据库的 `test:*` 全绿；本机 3002 dev 服务真实对话 start → 84 delta → done 且 delta 拼接等于最终内容，Admin Run COMPLETED；`smoke:grounded-answer` 因隔离库 public schema 未跑 migration（P2021，与本改动无关）无法执行。`/code-review high` 第一轮 6 条：修 4 条（包内 test 先建 contracts、死测试改正向断言、index 只导出 api 实际引用、5 处研究文档路径），不修 2 条（四个 tsx 测试脚本与六处 build 前缀按 Issue 范围保留）；第二轮 5 条：修 3 条（README 点名 tsx 脚本同样依赖 dist、watch 措辞改准、index 包级注释回到文件顶部），不修 2 条（build 前缀合并为闭包选择器超出 Issue 规格；`teeRawResponseCapture` / `adaptOpenAICompatibleStream` 导出是 api 运行时测试「原始 chunk → adapter → Runtime」回归所需）。`packages/agent` 仍在 R2 |
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
