# AI SEO Agent Docs

本目录负责文档导航。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-8：Completed
Phase 8：Completed
Active Agent Task：Retrieval 模块组织 #104（Gate READY）
DeepSeek 思考强度与 Usage（#94）：Completed
失败 Sampling 部分响应可观测性（#98）：Completed
Minimal Compaction：Gated
Admin Task 4：Planned
Phase 9：未定案
```

Phase 8 已完成：

- Task 0：Retrieval Boundary 与 lexical Evaluation baseline，#48 / #49 / `4c2f7950`；
- Task 1：deterministic Chunking、Gemini Embedding boundary 与 pgvector index，#50 / #52 / `76d66abf`；
- Task 2A：exact vector、Article aggregation、RRF 与 quality-v2，#54 / #55 / `3abdcb8a`；
- Task 2B：`retrieve_article_context@1`、受控 Observation 与 Agent Runtime 集成，#56 / #57 / `4f3ba1c1`；
- Task 3A：structured finalization、Citation validation、durable Grounding 与原子终态，#58 / #59 / `d6df7ac1`；
- Task 3B：Web Grounding 状态、Sources disclosure、Source cards 与 Chromium，#60 / #61 / `572ad206`；
- Task 3C：Admin Retrieval / Finalization / Citation Inspector，#62 / #63 / `20f838fb`。

当前仍处于 Phase 8 源码阅读阶段；独立横向任务 Issue #101（[Agent Runtime 模块组织](./tasks/agent-runtime-module-organization.md)）、Issue #102（[Admin Runs 模块组织](./tasks/admin-runs-module-organization.md)）与 Issue #103（[Article Chunking 模块组织](./tasks/article-chunking-module-organization.md)）均已验收合并，Issue #104（[Retrieval 模块组织](./tasks/retrieval-module-organization.md)）为 Active / Gate READY；Issue #98（[失败 Sampling 部分响应可观测性](./tasks/failed-sampling-debug-capture.md)）和 Issue #94（[DeepSeek 思考强度与 Usage](./tasks/deepseek-reasoning-usage.md)）均已验收合并。下一阶段学习内容暂不定义，Phase 9 尚未定案。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、学习闭环与 Phase 9 决策原则 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板和状态事实来源 |
| [失败 Sampling 部分响应可观测性](./tasks/failed-sampling-debug-capture.md) | Completed：#98 / PR #100 / `915315b` |
| [DeepSeek 思考强度与 Usage](./tasks/deepseek-reasoning-usage.md) | Completed：#94 / PR #95 / `2266fad` |
| [Article Chunking 模块组织](./tasks/article-chunking-module-organization.md) | Completed：#103 / PR #107 |
| [Retrieval 模块组织](./tasks/retrieval-module-organization.md) | Active：#104 / Gate READY |
| [Phase 8 归档](./tasks/completed/phase-08-grounded-retrieval.md) | Completed：Task 0-3C 全部内容、阶段不变量与边界 |
| [Grounded Answer / Citation 研究](./research/phase-08-grounded-answer-citation-design.md) | Provider、开源方案与架构定案 |
| [Phase 7 归档](./tasks/completed/phase-07-context-engineering.md) | Context Engineering 最终能力与边界 |
| [Phase 6 归档](./tasks/completed/phase-06-bounded-agent-loop.md) | Agent Loop、deadline、终态可靠性 |
| [Admin Console](./tasks/admin-console.md) | Admin Observability 支线 |
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
  -> Evidence-backed answer：
       Grounding Session
       -> Run Evidence Registry
       -> hidden final draft
       -> submit_grounded_answer@1
       -> server-side Citation validation
       -> validated delta replay
       -> Message + Grounding + Steps + Run 原子终态
       -> optional grounding on done / Messages API
       -> Web Grounding state + Sources disclosure
       -> Admin Retrieval / Finalization / Citation Inspector
```

## 当前源码阅读顺序

```text
Chunking / Indexing
  -> Embedding / pgvector
  -> lexical / vector / RRF
  -> Retrieval Tool / Observation
  -> Grounding Session / Registry
  -> finalization / Citation validation
  -> Stream / Messages API
  -> Web Source UI
  -> Admin Retrieval Inspector
```

该阶段属于讨论 / 学习模式，默认不创建 Issue、不修改正式代码。

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
- Active 必须有 Issue 且 Gate READY；
- Completed 必须有 GPT 技术验收和用户确认；
- 研究文档不能替代任务规格；
- Phase 9 未定案前，不自动启动 Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 或 Minimal Compaction。
