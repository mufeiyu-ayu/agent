# AI SEO Agent Docs

本目录只负责文档导航，不再复制完整任务状态。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-5：Completed
阶段 6：有界单 Agent Loop（Active）
  Task 0：Completed
  横向配置治理：Completed
  Task 1：Active（Issue #29 / Draft PR #30，已实现，待验收）
  Task 2：Planned（待 Task 1 验收并合并后再创建正式 Issue）
```

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 已完成阶段、当前阶段与阶段边界 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板、状态与执行顺序 |
| [tasks/phase-06-bounded-agent-loop/README.md](./tasks/phase-06-bounded-agent-loop/README.md) | 当前阶段 6 的能力、任务与验收边界 |
| [tasks/admin-console.md](./tasks/admin-console.md) | Admin Console 产品支线 |
| [development-workflow.md](./development-workflow.md) | Issue、Clarification Gate、Draft PR、验收和合并授权流程 |
| [research/README.md](./research/README.md) | Agent / Codex 架构研究与学习资料，不代表正式任务状态 |
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
- 当前 Task 细节写在对应 `docs/tasks/**`，已完成阶段放入 `docs/tasks/completed/**`。
- `work-log.md` 只保留近期关键事实；旧细节需要时查看 Git 历史与 Completed 归档。
- 阶段 6 完成前不提前编号后续 Agent 阶段。
