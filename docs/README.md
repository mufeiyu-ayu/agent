# AI SEO Agent Docs

本目录只负责文档导航，不复制完整任务状态。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-7：Completed
Active Agent Task：无
Minimal Compaction：Gated
下一阶段：尚未定案
```

Phase 7 `Context Engineering` 已完成 GPT 技术验收、用户确认验收，并通过 Issue #46 / PR #47 合入 `master`，merge commit 为 `caf3d25b7af0e5b30ae47d3c96faab4138fbdb9e`。Task 0-3 均已 Completed；阶段最终能力和验收证据已归档到 `docs/tasks/completed/**`。Minimal Compaction 当前没有足够证据进入正式实现，继续保持 `Gated`。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 已完成阶段、当前主线状态与后续候选方向 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板、状态与启动规则 |
| [tasks/completed/phase-07-context-engineering.md](./tasks/completed/phase-07-context-engineering.md) | Phase 7 最终能力、交付、验证和已接受边界 |
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

- `docs/README.md` 只做入口，不维护第二套任务看板；
- 当前 Task 细节写在对应 `docs/tasks/**`；已完成阶段统一压缩归档到 `docs/tasks/completed/**`；
- 完成阶段不继续在 active tasks 区保留兼容目录或长篇 Task 规格；详细历史由 Completed 归档、Issue / PR 和 Git 历史共同承担；
- `docs/work-log.md` 只保留近期关键事实；
- 当前没有 Active Agent Task；任何下一阶段都必须重新讨论、建立正式 Task / Issue 并通过 Clarification Gate 后才能进入 Active。
