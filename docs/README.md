# AI SEO Agent Docs

本目录只负责文档导航，不复制完整任务状态。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-6：Completed
阶段 7：Context Engineering / Active
Task 0：Context Boundary & Snapshot / Completed / #40 / #41 / 415e866a
Task 1：Model-aware Budget & Dynamic History / Completed / #42 / #43 / 6df72f0
Active Agent Task：无
下一正式 Task：Task 2 / Loop-aware Context & Observation Governance / Next / Issue 未创建
Task 3：Planned
```

Phase 6 已完成并统一归档到 `docs/tasks/completed/**`，不再在 active tasks 区保留兼容目录。Phase 7 当前为 Active；Task 0-1 已完成 GPT 技术验收、用户确认验收并合入 `master`。Task 2 已推进为 Next，但尚未创建 Issue，也未进入 Active；Task 3 仍为 Planned。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 已完成阶段、当前主线状态与阶段边界 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板、状态与启动规则 |
| [tasks/phase-07-context-engineering/README.md](./tasks/phase-07-context-engineering/README.md) | Phase 7 Context Engineering 阶段规划与 Task 边界 |
| [tasks/completed/phase-06-bounded-agent-loop.md](./tasks/completed/phase-06-bounded-agent-loop.md) | Phase 6 最终能力、交付、验证和已接受边界 |
| [tasks/admin-console.md](./tasks/admin-console.md) | Admin Console 独立产品支线 |
| [development-workflow.md](./development-workflow.md) | Issue、Clarification Gate、Draft PR、验收和合并授权流程 |
| [research/README.md](./research/README.md) | Agent / Codex 架构研究与候选学习资料，不代表正式任务状态 |
| [work-log.md](./work-log.md) | 已真实发生的近期关键推进与收口记录 |

## 事实来源

发生冲突时按以下顺序判断：

1. GitHub 当前代码、Issue、PR、Review、commit 与真实验证结果；
2. `docs/tasks/**` 的正式 Task 状态；
3. `docs/development-workflow.md` 的协作规则；
4. `docs/roadmap.md` 的阶段路线；
5. `docs/work-log.md` 的已发生事实；
6. `docs/research/**` 的研究资料。

## 维护原则

- `docs/README.md` 只做入口，不维护第二套任务看板。
- 当前 Task 细节写在对应 `docs/tasks/**`；已完成阶段统一压缩归档到 `docs/tasks/completed/**`。
- 完成阶段不继续在 active tasks 区保留兼容目录或长篇 Task 规格；详细历史由 Completed 归档、Issue / PR 和 Git 历史共同承担。
- `work-log.md` 只保留近期关键事实。
- Phase 7 当前为 Active；Task 0-1 已 Completed，Task 2 为 Next。Task 2 只有创建正式 Issue 并通过 Clarification Gate 后才进入 Active，后续 Task 仍按既定前置条件逐项推进。
