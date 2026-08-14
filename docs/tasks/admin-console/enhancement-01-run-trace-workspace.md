# Admin Console Enhancement 1：Run Trace Workspace

## 状态

```text
实施状态：已实现
验收状态：待验收
PR 状态：Draft
```

- Issue：#51 `[Admin Console][Enhancement 1] 将 Run Detail 重构为紧凑 Run Trace Workspace`
- 实现基线：`master@6af71d3b90e496377913c31e47c2aacb98eee509`
- 实现分支：`codex/issue-51-run-trace-workspace`
- Clarification Gate：`READY`
- Codex Review：本地 Review 唯一 P2（Overview 提示字段不完整）已修复
- PR：[#53](https://github.com/mufeiyu-ayu/agent/pull/53) / Draft

本任务是 Admin Observability 的独立 UX Enhancement，不是新的 Agent Phase，也不改变 Phase 8 Task 0-1 Completed、Task 2-3 Planned 或 Admin Task 4 Planned 的状态。

## 目标与交付

将单个 `/runs/:runId` 的卡片式 Timeline / Event Detail 重构为紧凑 Run-level Trace Workspace：

```text
Compact Run Header
  -> Trace Toolbar
  -> Input / Model / Tools Duration Overview
  -> Event / Content Ledger + Request Boundary
  -> Typed Inspector
```

实现使用现有 `AdminRunDetail` 安全 Read Contract，在 Admin 前端建立确定性 projection，并交付：

- 紧凑 Run Header 与 Duration / Requests / Calls / Tokens 统计；
- 三 Lane Duration Overview，使用真实 timing，支持点击选择与 0-duration / open marker；
- 每个 `model_sampling` 对应一个 UI Request Boundary，Tool 仅按 `samplingAttemptId` 归属；
- Event / Content Ledger、搜索、Request 折叠 / 展开、可预测选择回退与键盘操作；
- Request、Tool、Message、Generic 分类型 Inspector；
- Context、Usage、Timing 等渐进式 Tabs，并保留 Phase 7 Context Inspector 语义；
- 保留 Messages、Safe Raw、loading、empty、404、error / retry 与 stale-response fencing；
- light / dark、桌面与紧凑宽度布局。

Request Group 只是前端视图投影，不是 durable entity；页面表示单次 `AgentRun`，不得伪造 Conversation Turn。

## DeepSeek 只读参考证据

- 本地仓库：`/Users/lihaoran/Desktop/deepseek-harness`
- commit：`47f943859bef60e4160492346772ded9b24f765a`
- describe：`47f943859b`
- 状态：clean
- License：MIT
- 重点阅读：
  - `packages/client/ui-trajectory/src/client/TrajectoryView.tsx`
  - `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
  - `packages/client/ui-trajectory/src/client/TrajectoryTimeline.tsx`
  - `packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts`
  - `packages/client/runtime/src/client/sessions/request-inspection.ts`
  - `packages/client/runtime/src/client/sessions/assistant-timing.ts`
  - 相关 styles、toolbar、search / timeline helpers 与 tests

采用的是 projection 与 View 分层、Request 作为可见检查边界、三 Lane overview、紧凑 Ledger、稳定选择、搜索 / 折叠和渐进 Inspector。未复制 React / CSS，也未迁移 Session 多 Turn、历史补页、虚拟列表、Tail Follow、Range / Zoom / Pan、Provider options、TTFT、raw prompt、reasoning 或 raw Tool payload。

DeepSeek 的 Session Trajectory 聚合多个 Turn；本项目只展示一个 `AgentRun`。DeepSeek 搜索可以索引更丰富的本地详情，而本实现只能索引 Admin allowlist 安全字段；其 assistant timing 依赖真实 first-token 事实，本项目没有该事实，因此不推算 TTFT / Generation / Throughput。

## 安全与范围边界

- 不修改 `apps/api/src/agent-runtime/**`、`apps/api/src/admin-runs/**`、`packages/contracts/src/admin-run.ts`、Prisma schema / migration；
- 不读取 raw `AgentStep.input/output`，搜索、Inspector、Safe Raw、fixture 和截图只使用 Admin allowlist projection；
- 不展示完整 Prompt、reasoning、raw Tool arguments / result、完整 Observation、Provider raw payload、Secret 或 Authorization；
- 不新增 Provider、TTFT、Generation、Throughput、Cache / Reasoning Usage 或 retry 遥测；缺失事实显示 unavailable；
- 不实现 Session Trajectory、durable Request、实时更新、虚拟列表、历史分页、Range / Zoom / Pan、Run replay / retry / resume / cancel；
- 不修改 Article Indexing、`EMBEDDING_*`、Phase 8 Task 2-3 或 Admin Task 4。

## 决策追踪

| ID | 落实结果 |
| --- | --- |
| D-01 | 保持单 Run Workspace 语义，不生成 `Turn N`。 |
| D-02 | 仅消费现有 Contract；未记录遥测明确为 unavailable。 |
| D-03 | `model_sampling` 建立 Request，Tool 仅按 `samplingAttemptId` 归属；重复 / 未匹配项保持 unlinked。 |
| D-04 | 不修改 Runtime、Admin API、共享 Contract 或 Prisma。 |
| D-05 | Overview 只做三 Lane、真实 timing、点击选择与 marker，不做范围、缩放或平移。 |
| D-06 | 主列表、搜索和 Inspector 继续遵守 Admin 安全投影。 |
| D-07 | 当前单 Run 规模不引入虚拟化或 Tail Follow。 |
| D-08 | 本任务独立于 Phase 8，不提前实现 Retrieval UI。 |
| D-09 | 以 Task 1 已合并后的 `master@6af71d3b` 开工，保留 Article Indexing 与 Phase 8 状态。 |
| D-10 | 实施前实际阅读 DeepSeek Harness `47f943859b`，只借鉴信息架构和交互边界。 |

## 验收追踪

| AC | 实现状态 | 验证状态 |
| --- | --- | --- |
| AC-01 | Trace 生产路径已切换为紧凑 Workspace，旧主布局不并存。 | Admin build 与真实浏览器通过 |
| AC-02 | `AdminRunDetail -> RunTraceProjection` 映射集中在纯前端 presenter。 | Admin data checks 通过 |
| AC-03 | Request 与 Tool 使用稳定 `samplingAttemptId` 关联，异常关联 fail safe。 | 自动断言与 one / two-tool 浏览器通过 |
| AC-04 | 三 Lane Overview 使用真实 timing、完整时序提示，并与 Ledger / Inspector 选择同步。 | 自动断言、Review 修复与 Overview 点击通过 |
| AC-05 | Ledger 已实现搜索、折叠、选中回退、键盘操作和长文本约束。 | 自动断言；浏览器搜索 / 折叠通过 |
| AC-06 | Request / Tool / Message / Generic Inspector 采用渐进 Tabs。 | typed / generic 浏览器检查通过 |
| AC-07 | Context Budget / Sources / Adjustments / Outcome 语义保留。 | Context available 浏览器检查通过 |
| AC-08 | 未推算缺失遥测，0 与 null 分离。 | Admin data checks 通过 |
| AC-09 | 搜索、Inspector 与截图只使用安全投影。 | 安全 JSON 解析与字段排除检查通过 |
| AC-10 | 非正常状态、错误 / retry 与 stale-response fencing 沿用既有边界。 | RUNNING / FAILED / Generic 与快速切换通过 |
| AC-11 | Messages、Safe Raw 与返回列表 query context 保留。 | 浏览器标签回归通过 |
| AC-12 | 已提供 light / dark 与紧凑宽度降级布局。 | 1440×900、1280×900、Sidebar 双态通过 |
| AC-13 | 实现范围限定在 Admin 前端与本任务文档 / 截图。 | diff scope 已确认 |
| AC-14 | 定向测试与规定命令全部通过。 | PASS |
| AC-15 | 文档仅记录“已实现、待验收”。 | 已满足 |

## 自动验证

以下命令已在实现分支真实执行：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/contracts build` | PASS |
| `pnpm --filter @agent/admin test` | PASS |
| `pnpm --filter @agent/admin typecheck` | PASS |
| `pnpm --filter @agent/admin lint` | PASS |
| `pnpm --filter @agent/admin build` | PASS |
| `pnpm --filter @agent/api test:admin-runs` | PASS（22 tests） |
| `pnpm --filter @agent/api typecheck` | PASS |
| `pnpm typecheck` | PASS |
| `git diff --check` | PASS |
| `git diff --cached --check` | PASS |

## 浏览器与截图证据

已使用真实 Nest API、Admin Vite 与独立 Chromium 完成验收；临时安全 fixture 只写入 allowlist 数据，截图后已删除，API 回查为 `404`。证据路径：

- `docs/assets/admin-console/enhancement-01-trace-workspace/direct-final-light.png`
- `docs/assets/admin-console/enhancement-01-trace-workspace/two-tool-dark.png`
- `docs/assets/admin-console/enhancement-01-trace-workspace/context-inspector-light.png`
- `docs/assets/admin-console/enhancement-01-trace-workspace/running-or-failed.png`
- `docs/assets/admin-console/enhancement-01-trace-workspace/compact-width.png`

实际覆盖：

- direct-final、one-tool、two-tool / 三次 Sampling、两个 Tool 的 Request 归属；
- Context available、RUNNING open marker / `endedAt=null`、FAILED、Generic / legacy fallback；
- 搜索 `8 -> 1 -> 0`、Request 折叠 / 展开、Overview 点击与 typed Inspector 联动；
- Messages、Safe Raw；安全 JSON 仅含 `agentRun / agentSteps`，不含 `promptDetail / inputDetail / outputDetail / Authorization`；
- light / dark、1440×900、1280×900、Sidebar 展开 / 收起；两种宽度均无全局水平溢出；
- two-tool 与 direct-final 快速切换后最终 Run ID、Request 和 Tool 数量一致；
- 浏览器 console `warn / error` 为空。

## 学习结论

- durable `AgentStep` 是运行事实，UI Request Boundary 是便于扫读的派生分组，Conversation Turn 则是更高层产品语义，三者不能混用；
- Ledger 将稳定排序的事件留在主阅读面，Inspector 才按选择渐进展示细节，比“一 Step 一 Card”更适合横向比较；
- `estimatedInputTokens` 是 Context 规划估算，Provider usage 是实际回传；TTFT 需要 first-token 时间戳，不能从总时长推导；
- 安全 Read Contract 与前端 projection 分层，使 UI 可以重组诊断信息而不接触 raw Runtime payload。

## 后续限制

本任务保持 Draft / 待验收。只有 GPT 技术验收通过、用户明确确认并授权后，才能转 Ready、合并、关闭 Issue 或标记 Completed。
