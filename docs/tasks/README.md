# Tasks

本目录是正式任务状态的事实来源。规格、验收标准与决策记录在 GitHub Issue；已完成任务与阶段的详细记录在 [`completed/`](./completed/)、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Active Agent Task：无
Next：#116 同轮文本 + 多 Tool Call（前置 #115 已于 2026-09-18 合并）
Planned：web_fetch（R2 前）
Gated：#117 Responses API adapter（2026-09-18 关闭转 Gated，触发条件见看板）
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
| #126 Admin Run 读模型去过度设计 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #128 于 2026-09-18 基于最新 head `a7a8cf6` 逐条验收 AC-01～AC-08 PASS 并合并（47 files，+1,386 / −6,997，净减 5,611）：契约收缩为运维真正要的事实（删 9 个类型、常量 / 重复 / 可信度字段与 `safeRawData`，列表项 token 字段合并为 `usage`），四个 projector 合计 850 行、逐字段「能读就读、读不出就 null」、不做跨字段与跨 Step 校验，runtime 停写被删字段（零行为变化），Admin 只删展示项并用 `stepId` 关联 timeline；旧库 Run 全部 known Step、`receive_user_message` 投影为 generic；本机 dev 服务真实对话 + 查库核对 + Playwright 打开 Run Trace 零 console 错误。验证：typecheck 6/6、api / admin lint、api 7 组测试与 admin 三个 check 全绿。`/code-review high` 两轮 11 条：修 10 条，`grounding: true` 整行读取按 AC-01 保留。Review 遗留补修 PR #130 于 2026-09-18 基于 head `73c9652` 验收 PASS 并合并（`3a488bc`）：`chunkId` 身份原样保留、`evidenceRefCount` 未知时为 null；F-03 / S1 记为待决策不改，F-04 按 Issue 不采纳。学习环节：待带读与独立改一处，通过后在 Issue 追加「学习已验证」 |
| #127 收敛 `packages/ai` 运行时配置 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #129 于 2026-09-18 基于最新 head `95e74c6` 逐条验收 AC-01～AC-06 PASS 并合并（7 files，+73 / −216）：`LLMRuntimeConfig` 收为 `{ apiKey, baseUrl, model, captureModelIO }`，三个 timeout 改 `openai-completions.ts` 常量、`max_tokens` 默认 65_536 改 `config.ts` 常量，删应用硬上限层、`readPositiveInteger` 与 4 个 `LLM_*` env；`config.test.ts` 11 → 9 case，`llm.module.test.ts` 改断言 `captureModelIO` 默认 false 与 `LLM_MODEL` 不支持时初始化失败。验证：`/ai` typecheck / test 35/35 / build，api typecheck / lint，`test:llm-config` 2/2、`test:model-stream` 78/78，`git diff --check` 通过；AC-01 grep 零匹配。`/code-review high` 两轮 7 条：修 5 条（含第二轮收回超范围的默认 `max_tokens` clamp），残留 env 静默忽略与 `chat` 60s 数值按 Issue 范围不改。学习环节按 Issue 决策记录豁免 |
| #115 模型调用重试与 Loop 默认上限 | Completed | 实施状态：已实现 / 验收状态：已通过。PR #131 于 2026-09-18 基于最新 head `4efc5b2` 逐条验收 AC-01～AC-06 PASS 并合并（7 files，+329 / −29；AC-01 字面 grep 的 5 处 `readPositiveInteger` 是 #126 Admin 投影 safe reader，origin/master 已存在、与本 Issue 无关）：`createClient()` 交给 SDK 内置重试的 `maxRetries` 改为代码常量 2（首个响应头之前；流正文中断、abort 后不重试），无新增 env；review 后补两处：`chatStream` 内 `rejectOnAbort`（SDK 退避 sleep 不监听 signal 且 `retry-after` 无上限，abort 落在 sleep 期间也立即抛出）与 `AbortSignal.any` 派生一次性信号（SDK 每次尝试在 signal 上挂监听不移除，10 轮 + 1 次重试即触发 `MaxListenersExceededWarning`）；policy 默认 `maxSamplingRounds` 3 → 10、`maxToolCalls` 2 → 8，`.env.example` / README 同步；`openai-completions.test.ts` 新增 8 个用例（1 个 `maxRetries` 常量断言 + 7 个 fake fetch：首次 429 / 503 / 连接错误后成功且 `onRequest` 只记一次、400 / 401 / 402 不重试、重试耗尽抛对应 `LLMError`、流正文中断不重试、abort 不重试、abort 落在退避 sleep 期间立即抛出、12 轮共用 signal 不累积监听）。验证：`@agent/ai` typecheck / test 43/43，api typecheck / lint、`test:tool-loop` 65/65、`test:tools` 86/86、`test:llm-config` 2/2、`test:model-stream` 78/78、`test:admin-runs` 55/55、`test:grounding` 172/172。Review：`/code-review high`（Opus）+ Fable agent 各 3 条、Fable 复审 2 条，修 5 条（abort 竞速、监听隔离、上限耦合提示、看板文案、timeout 注释），非流式 / metadata 请求无 signal 的最坏耗时按范围记录不改。学习环节：待带读与独立改一处，通过后在 Issue 追加「学习已验证」 |
| #116 同轮文本 + 多 Tool Call | Next | content 先于 tool_calls、多个 tool_calls 顺序执行、上限解耦、截断参数回喂；前置 #115 已合并 |
| #117 Responses API adapter | Gated | 2026-09-18 关闭（not planned）：DeepSeek 上 Responses 与 Chat 无能力差异且无状态，为证明边界写第二实现属过度设计；Pi 的 DeepSeek 也走 completions。映射规格保留在 Issue，满足任一条件 reopen：DeepSeek 弃用 Chat Completions / 需要仅 Responses 有的能力 / 接入只支持 Responses 的第二 provider |
| `web_fetch` 第一个真实工具 | Planned | 只读、SSRF 防护、untrusted observation；前置 #115 / #116，范围见 [pi-reference roadmap](../research/pi-reference/roadmap.md) |
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
