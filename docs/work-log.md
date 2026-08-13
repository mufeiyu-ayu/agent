# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-7 Completed；当前无 Active Agent Task | 基于最新 `master` 重新讨论下一阶段 |
| Phase 6 | Completed / 已归档 | `docs/tasks/completed/phase-06-bounded-agent-loop.md` |
| Phase 7 | Completed / merge `caf3d25b` | `docs/tasks/completed/phase-07-context-engineering.md` |
| Minimal Compaction | Gated | 只有真实 Context 压力证据满足触发条件后才讨论 |
| Admin Console | Task 0-3 Completed；Observability Baseline + Context Inspector 已建立；Task 4 Planned | 不自动启动 Auth / RBAC |
| Web Chat | 会话滚动跟随与响应式 UI follow-up 已完成 | 出现真实 UX 问题时再迭代 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-13 | Phase 7 / Task 3 最终收口 | GPT 基于 Issue #46、PR #47 最新 head `e0eaa33`、P2 修复、自动验证、最终 Codex Review 与真实 API / PostgreSQL / 浏览器证据完成技术验收；用户确认验收并授权 Ready、合并与关闭；PR #47 合入 `master`，merge `caf3d25b7af0e5b30ae47d3c96faab4138fbdb9e`，Issue #46 Closed；Task 3 与 Phase 7 Completed；Minimal Compaction 继续 Gated |
| 2026-08-13 | PR #47 GPT Review P2 修复 | 收紧 initial budget、Observation、fail-closed outcome 与跨 sampling Domain invariants；修正 two-tool pre-plan `4 / 6 / 7`、Provider `4 / 5 / 7`、真实 fixture 和截图并复跑验证 |
| 2026-08-13 | Issue #46 / Task 3 实现 | 完成 Context Inspector Read Model、sampling estimator failure 安全枚举、legacy / partial fallback、Budget / Sources / Adjustments UI、自动回归与真实浏览器证据 |
| 2026-08-13 | Phase 7 Task 2 收口 | Issue #44 / PR #45，merge `2f06355c`；Loop Context、History 再选择、Observation 双层治理与 fail-closed 完成 |
| 2026-08-12 | Phase 7 Task 1 收口 | Issue #42 / PR #43，merge `6df72f0`；model-aware budget、DeepSeek V4 TokenEstimator 与 Dynamic History 完成 |
| 2026-08-10 | Phase 7 Task 0 收口 | Issue #40 / PR #41，merge `415e866a`；单 Run `ModelContext` 与安全 Context Snapshot 完成 |
| 2026-08-10 | Phase 7 路线定案 | Context Engineering 成为 Phase 6 后主线；Task 0-3 分阶段实施；Minimal Compaction 为 Gated follow-up |
| 2026-08-10 | Web Chat UI 收口 | Issue #37 / PR #38，merge `415d7405`；滚动跟随、scroll memory 与响应式布局完成 |
| 2026-08-10 | Admin Task 3 收口 | Issue #35 / PR #36，merge `4c689c4c`；真实 Run Trace UI 与浏览器验收完成 |
| 2026-08-09 | Admin Task 2 收口 | Issue #33 / PR #34，merge `997d6b84`；真实 Run / Step Query API 完成 |
| 2026-08-09 | Phase 6 reliability 收口 | Issue #31 / PR #32，merge `691efbcd`；DB deadline、late-result fencing 与原子 terminalization 完成 |
| 2026-08-08 | Phase 6 Agent Loop 收口 | Issue #29 / PR #30，merge `904b011d`；bounded sequential Agent Loop 完成 |

## 当前阶段边界

```text
阶段 1-7            Completed
Active Agent Task   无
Minimal Compaction  Gated
下一阶段            尚未定案
```

Phase 7 已完成：

```text
ModelContext Boundary
  -> model-aware input budget
  -> Dynamic History Selection
  -> per-sampling Loop Context Plan
  -> Observation Governance
  -> durable safe metadata
  -> Admin Context Inspector
```

Minimal Compaction 不自动启动。只有真实 Inspector 数据证明旧 Context 被频繁驱逐，并对连续性、质量、成本或延迟造成可复现影响时，才创建独立 Task / Issue。

## 记录规则

- 只记录已经真实发生的事项；
- 实现、验收、Task 收口、合并与开始下一 Task 是不同动作；
- 长期研究进入 `docs/research/**`；
- 旧阶段细节不在这里重复维护；
- 当前无 Active Agent Task，任何后续方向必须先重新讨论并进入正式 Issue 流程。
