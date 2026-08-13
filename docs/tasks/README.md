# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **Phase 8 Task 0 Active** | [roadmap.md](../roadmap.md) | Issue #48；Retrieval Boundary 与离线 Evaluation Baseline 已实现、待验收 |
| Phase 8：Grounded Retrieval / RAG Baseline | **Active** | [task-00-retrieval-boundary-evaluation.md](./phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md) | Task 0 已实现、待验收；不提前启动 Task 1 |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；merge `caf3d25b`；Minimal Compaction 继续 Gated |
| Phase 6：有界单 Agent Loop | Completed | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | Task 0、横向配置治理、Task 1、Task 2 均已验收并合并 |
| Admin Console Task 0-1 | Completed | [admin-console.md](./admin-console.md) | 基础壳与静态 Run UI 已完成 |
| Admin Console Task 2 | **Completed** | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | Issue #33 / PR #34；merge `997d6b84` |
| Admin Console Task 3 | **Completed** | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | Issue #35 / PR #36；merge `4c689c4c`；真实 Observability UI 基线已建立 |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | 登录、权限与敏感信息脱敏；当前不启动 |
| Web Chat Scroll / UI Follow-up | **Completed** | [work-log.md](../work-log.md) | Issue #37 / PR #38；merge `415d7405` |
| Phase 5：最小 Tool Calling | Completed | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | 已归档 |
| Phase 4：Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档 |
| Phase 3：Streaming | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已归档 |
| Phase 2：Session Chat | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 已归档 |

## Agent 主线状态

```text
阶段 1-7：Completed
Phase 8 Task 0：Active / 已实现、待验收
Minimal Compaction：Gated
```

Phase 7 最终交付：

| Task | 状态 | Issue / PR | Merge commit | 核心结果 |
| --- | --- | --- | --- | --- |
| Task 0：Context Boundary & Snapshot | Completed | #40 / #41 | `415e866a` | 单 Run `ModelContext`、Tool Exchange 成对维护与安全 Context Snapshot |
| Task 1：Model-aware Budget & Dynamic History | Completed | #42 / #43 | `6df72f0` | model-aware input budget、DeepSeek V4 TokenEstimator、token-budget Dynamic History |
| Task 2：Loop-aware Context & Observation Governance | Completed | #44 / #45 | `2f06355c` | per-sampling Context Plan、follow-up History exclusion、Observation 双层治理 |
| Task 3：Context Inspector & Phase Baseline | Completed | #46 / #47 | `caf3d25b` | 安全 Context Read Model、Admin Inspector、领域不变量与阶段验收基线 |

Task 3 已由 GPT 基于 Issue #46、PR #47 最新 head `e0eaa33e449486a5b30a0a87ba654460fe62fbaf`、上一轮 P2 修复、自动测试、最终 Codex Review 和真实 API / PostgreSQL / 浏览器证据完成技术验收。用户于 2026-08-13 明确确认验收并授权 Draft 转 Ready、合并和关闭；PR #47 已合入 `master`，merge commit 为 `caf3d25b7af0e5b30ae47d3c96faab4138fbdb9e`，Issue #46 已关闭。

因此：

- Task 3 正式状态为 `Completed`；
- Phase 7 正式状态为 `Completed`；
- Phase 7 active 规格已压缩归档到 [`completed/phase-07-context-engineering.md`](./completed/phase-07-context-engineering.md)；
- Phase 7 收口当时没有 Active Agent Task；Phase 8 Task 0 现已进入 Active；
- Minimal Compaction 没有被自动启动，继续保持 `Gated`。

## Admin Console 当前状态

```text
Task 0：基础壳                     Completed
Task 1：静态 Run List / Detail     Completed
Task 2：真实 Run / Step Query API  Completed
Task 3：真实 Run Trace UI          Completed
Task 4：Auth / RBAC / 脱敏         Planned
```

Admin Task 2 + Task 3 已建立真实 Observability Baseline：服务端安全 Read Model、真实 Run / Step Query API、server pagination / filters、Run Trace UI、Typed / Generic Inspector、失败态、stale-response fencing、Computer Use 浏览器验收与截图证据均已完成。

Phase 7 Task 3 已在该基线上增加 Context Inspector，但不自动启动 Admin Task 4。

## 当前正式动作

Phase 8 Task 0 已通过 Issue #48 的 Clarification Gate，并完成本地实现与验证，等待 Draft PR 技术验收。Task 1 尚未创建正式 Issue，不得提前启动。

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
