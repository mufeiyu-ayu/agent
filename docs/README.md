# AI SEO Agent Docs

本目录只负责文档导航。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-7：Completed
Phase 8：Active
Task 0、1、2A、2B：Completed
Task 3A：Next
Task 3B、3C：Planned
Active Agent Task：无
Minimal Compaction：Gated
```

Phase 8 当前已完成：

- Task 0：Retrieval Boundary 与 lexical Evaluation baseline，#48 / #49 / merge `4c2f7950`；
- Task 1：deterministic Chunking、Embedding boundary 与 pgvector index，#50 / #52 / merge `76d66abf`；
- Task 2A：Gemini、exact vector、Article aggregation、RRF 与 quality-v2，#54 / #55 / merge `3abdcb8a`；
- Task 2B：`retrieve_article_context@1`、受控 Observation 与 Agent Runtime 集成，#56 / #57 / merge `4f3ba1c1`。

Task 3 已完成研究与拆分：3A 后端契约为下一项正式任务，3B Web Source UI 与 3C Admin Retrieval Inspector 保持 Planned。当前尚未创建 Issue 或执行 Clarification Gate。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、Phase 8 顺序与当前正式动作 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板和状态事实来源 |
| [Phase 8 总览](./tasks/phase-08-grounded-retrieval/README.md) | Task 0-3C、阶段不变量与完成条件 |
| [Task 3 编排](./tasks/phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md) | Task 3A / 3B / 3C 的依赖与共享边界 |
| [Task 3A](./tasks/phase-08-grounded-retrieval/task-03a-grounded-answer-citation-contract.md) | Next：Grounded Answer / Citation Backend Contract |
| [Task 3B](./tasks/phase-08-grounded-retrieval/task-03b-web-source-ui.md) | Planned：Web Chat Source UI |
| [Task 3C](./tasks/phase-08-grounded-retrieval/task-03c-admin-retrieval-inspector.md) | Planned：Admin Retrieval Inspector |
| [Grounded Answer / Citation 研究](./research/phase-08-grounded-answer-citation-design.md) | Codex、Provider 与开源社区方案对比及架构定案 |
| [Phase 7 归档](./tasks/completed/phase-07-context-engineering.md) | Context Engineering 最终能力与边界 |
| [Phase 6 归档](./tasks/completed/phase-06-bounded-agent-loop.md) | Agent Loop、deadline、终态可靠性 |
| [Admin Console](./tasks/admin-console.md) | Admin 独立产品支线 |
| [development-workflow.md](./development-workflow.md) | Issue、Gate、Draft PR、验收和合并流程 |
| [research/README.md](./research/README.md) | 架构研究入口，不代表实现状态 |
| [work-log.md](./work-log.md) | 已发生里程碑 |

## 当前能力链路

```text
用户问题
  -> Agent Runtime / DeepSeek sampling
  -> search_articles / retrieve_article_context / get_article_detail
  -> candidate / unverified / untrusted Observation
  -> Context Planner
  -> follow-up sampling
  -> 当前最终回答
```

Task 3A 将在不改变普通回答路径的前提下，为 evidence-backed answer 增加：

```text
Grounding Session / evidence availability
  -> structured finalization
  -> server-side citation validation
  -> durable Message Grounding
  -> optional grounding on done / Messages API
```

## 事实来源

发生冲突时按以下顺序判断：

1. GitHub 当前代码、Issue、PR、Review、commit 与真实验证；
2. `docs/tasks/**`；
3. `docs/development-workflow.md`；
4. `docs/roadmap.md`；
5. `docs/work-log.md`；
6. `docs/research/**`。

## 维护原则

- `docs/README.md` 只做入口；
- 一个正式 Issue 只对应一个明确 Task；
- Next 不等于 Active；
- Active 必须有 Issue 且 Gate READY；
- Completed 必须有 GPT 技术验收和用户确认；
- 研究文档不能替代任务规格；
- 下一步只允许创建 Task 3A Issue，不得自动启动 3B、3C、Admin Task 4 或 Minimal Compaction。
