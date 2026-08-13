# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **Phase 7 Active / Task 3 已实现、待验收** | [roadmap.md](../roadmap.md) | Task 0-2 已 Completed；Task 3 对应 Issue #46 |
| Phase 7：Context Engineering | **Active** | [phase-07-context-engineering/README.md](./phase-07-context-engineering/README.md) | Task 0-2 Completed；Task 3 实施完成、等待验收；Compaction 为 Gated follow-up |
| 阶段 6：有界单 Agent Loop | Completed | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | Task 0、横向配置治理、Task 1、Task 2 均已验收并合并 |
| Admin Console Task 0-1 | Completed | [admin-console.md](./admin-console.md) | 基础壳与静态 Run UI 已完成 |
| Admin Console Task 2 | **Completed** | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | Issue #33 / PR #34；merge `997d6b84` |
| Admin Console Task 3 | **Completed** | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | Issue #35 / PR #36；merge `4c689c4c`；真实 Observability UI 基线已建立 |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | 登录、权限与敏感信息脱敏；当前不启动 |
| Web Chat Scroll / UI Follow-up | **Completed** | [work-log.md](../work-log.md) | Issue #37 / PR #38；merge `415d7405` |
| 阶段 5：最小 Tool Calling | Completed | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | 已归档 |
| 阶段 4：Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档 |
| 阶段 3：Streaming | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已归档 |
| 阶段 2：Session Chat | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 已归档 |

## Agent 主线状态

```text
阶段 1-6：Completed
阶段 7：Context Engineering / Active
Task 0：Context Boundary & Snapshot / Completed / #40 / #41 / 415e866a
Task 1：Model-aware Budget & Dynamic History / Completed / #42 / #43 / 6df72f0
Task 2：Loop-aware Context & Observation Governance / Completed / #44 / #45 / 2f06355c
当前任务：Task 3 / Context Inspector & Phase Baseline / Active / #46 / 已实现、待验收
```

Task 0 已由 GPT 基于 Issue #40、PR #41 最新实现、Codex Review 和验证结果完成技术验收，并由用户明确确认通过。PR #41 已合入 `master`，Issue #40 已关闭。

Task 1 已由 GPT 基于 Issue #42、PR #43 最新 head `620a2d0`、两轮 Codex Review 与完整验证结果完成技术验收；用户于 2026-08-12 明确确认验收并授权收口。PR #43 已合入 `master`，merge commit `6df72f02242a1b8a23920d64c471ce721ccf558b`，Issue #42 已关闭，因此 Task 1 正式状态为 `Completed`。

Task 2 已由 GPT 基于 Issue #44、PR #45 最新 head `810b4b717ad65c950ee6b7b51de70e6f41fb83da`、Review finding 修复、新增回归、独立 Codex Review 与完整验证记录完成技术验收；用户于 2026-08-13 明确确认按 Completed 状态收口。PR #45 已合入 `master`，merge commit `2f06355ccfbe86d5b7492d770250b776e5da79f1`，Issue #44 已关闭，因此 Task 2 正式状态为 `Completed`。

Task 3 已按 Issue #46 完成 `READY` Clarification Gate、Context Inspector Read Model、最小安全 estimator failure 枚举、Admin API / Contract / UI、自动回归与真实 API + 本地 PostgreSQL 浏览器证据。实施状态为已实现，验收状态为待验收；Task 3 和 Phase 7 均不得在 GPT 技术验收与用户确认前标记 Completed。

## Phase 7 当前任务

| Task | 状态 | 核心边界 |
| --- | --- | --- |
| Task 0：Context Boundary & Snapshot | **Completed / #40 / #41 / merge 415e866a** | 收敛 model input assembly；建立安全 Context Snapshot；不改变 40 条 History 与现有 Observation 行为 |
| Task 1：Model-aware Budget & Dynamic History | **Completed / #42 / #43 / merge 6df72f0** | 让 `contextWindowTokens` 进入真实预算；History 从固定条数升级为 token-budget 驱动 |
| Task 2：Loop-aware Context & Observation Governance | **Completed / #44 / #45 / merge 2f06355c** | 多轮 Tool Loop 的 Context Budget、Tool Call / Result pairing 与 Observation 最终裁剪 |
| Task 3：Context Inspector & Phase Baseline | **Active / #46 / 已实现、待验收** | 安全 Context Read Model + Admin Inspector + 阶段回归与浏览器证据 |
| Minimal Compaction | Gated | 只有 Task 1-3 的真实证据证明需要时才另建正式 Task / Issue |

阶段完整规格见 [`phase-07-context-engineering/README.md`](./phase-07-context-engineering/README.md)。

下一动作是由 GPT 基于 Issue #46、Draft PR、自动验证、真实 Run 与浏览器证据完成 Task 3 技术验收，并决定 Phase 7 Baseline 是否可收口；Minimal Compaction 不自动启动。

## Admin Console 当前状态

```text
Task 0：基础壳                     Completed
Task 1：静态 Run List / Detail     Completed
Task 2：真实 Run / Step Query API  Completed
Task 3：真实 Run Trace UI          Completed
Task 4：Auth / RBAC / 脱敏         Planned
```

Task 2 + Task 3 已建立真实 Observability Baseline：服务端安全 Read Model、真实 Run / Step Query API、server pagination / filters、Run Trace UI、Generic Inspector、失败态、stale response fencing、Computer Use 浏览器验收与截图证据均已完成。

Admin Console 是独立 Observability 支线。Phase 7 Task 3 只基于现有基线增量加入 Context Inspector，不自动启动 Admin Task 4。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Next | 已确认是下一项正式任务，但尚未启动，或 Issue 已创建但仍等待 Clarification Gate |
| Active | 已创建 Issue 且 Clarification Gate 为 READY，正在实现或待验收 |
| Planned | 方向已记录，前置条件或启动决策尚未满足 |
| Gated | 只有预先定义的客观触发条件满足后，才重新讨论是否转为正式 Task |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认收口；合并状态另行记录 |

## 新任务规则

新任务使用 [_template.tdd.md](./_template.tdd.md)，至少写清目标、代码事实、范围、TDD、验收标准、验证命令、风险和 GitHub 交付状态。

完整协作流程见 [`../development-workflow.md`](../development-workflow.md)。
