# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **Phase 7 Next / 无 Active Task** | [roadmap.md](../roadmap.md) | 阶段 1-6 已完成；Phase 7 Context Engineering 已确认是下一主线 |
| Phase 7：Context Engineering | **Next** | [phase-07-context-engineering/README.md](./phase-07-context-engineering/README.md) | Task 0 已创建 Issue #40；首轮 Gate BLOCKED，阻塞决策已同步，等待重新 Gate；Task 1-3 Planned；Compaction 为 Gated follow-up |
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
阶段 7：Context Engineering / Next
当前：无 Active Agent Task
下一正式 Task：Phase 7 Task 0 / Context Boundary & Snapshot / Next
Issue：#40 已创建
Gate：首轮 BLOCKED；阻塞决策已同步，等待重新 Gate
```

Phase 7 已经完成阶段级与 Task 级规划，Task 0 的正式 Issue #40 已创建。首轮 Clarification Gate 因 Draft / Ready PR 规则和 docs 状态漂移返回 `BLOCKED`；对应流程规则与状态事实已由 GPT 同步到 `master`。在 Codex 重新 Gate 为 `READY` 前，Task 0 仍保持 `Next`，当前仍没有 Active Agent Task。

## Phase 7 当前任务

| Task | 状态 | 核心边界 |
| --- | --- | --- |
| Task 0：Context Boundary & Snapshot | **Next / Issue #40 / 待重新 Gate** | 收敛 model input assembly；建立安全 Context Snapshot；不改变 40 条 History 与现有 Observation 行为 |
| Task 1：Model-aware Budget & Dynamic History | Planned | 让 `contextWindowTokens` 进入真实预算；History 从固定条数升级为 token-budget 驱动 |
| Task 2：Loop-aware Context & Observation Governance | Planned | 多轮 Tool Loop 的 Context Budget、Tool Call / Result pairing 与 Observation 最终裁剪 |
| Task 3：Context Inspector & Phase Baseline | Planned | 安全 Context summary + Admin Inspector + 阶段回归 |
| Minimal Compaction | Gated | 只有 Task 1-3 的真实证据证明需要时才另建正式 Task / Issue |

阶段完整规格见 [`phase-07-context-engineering/README.md`](./phase-07-context-engineering/README.md)。

下一动作是让 Codex 重新读取 Issue #40、最新 `master` 和协作规范，重新执行 Clarification Gate。只有 Gate 结论为 `READY` 后，Task 0 才进入 `Active` 并创建独立实现分支。

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