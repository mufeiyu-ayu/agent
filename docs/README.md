# AI SEO Agent Docs

本目录负责文档导航。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-8：Completed
Active Agent Task：无
方向：runtime 深化（2026-09-05 定案，作品是 runtime 本身，参照 Codex 与 DeepSeek Harness）
当前阶段：源码阅读
候选子系统：session 事件流与 replay、审批门、compaction、定时任务（候选不等于 Active）
翻译质检站：已删除（#113）
Admin Task 4：Planned
```

Phase 8 已完成：

- Task 0：Retrieval Boundary 与 lexical Evaluation baseline，#48 / #49 / `4c2f7950`；
- Task 1：deterministic Chunking、Gemini Embedding boundary 与 pgvector index，#50 / #52 / `76d66abf`；
- Task 2A：exact vector、Article aggregation、RRF 与 quality-v2，#54 / #55 / `3abdcb8a`；
- Task 2B：`retrieve_article_context@1`、受控 Observation 与 Agent Runtime 集成，#56 / #57 / `4f3ba1c1`；
- Task 3A：structured finalization、Citation validation、durable Grounding 与原子终态，#58 / #59 / `d6df7ac1`；
- Task 3B：Web Grounding 状态、Sources disclosure、Source cards 与 Chromium，#60 / #61 / `572ad206`；
- Task 3C：Admin Retrieval / Finalization / Citation Inspector，#62 / #63 / `20f838fb`。

Phase 8 之后的横向任务 #92、#94、#98 与 Backend 模块组织 #101-#104 均已验收合并；翻译质检站 A-1（#109）/ A-2（#111）曾合入 master，该方向于 2026-09-02 放弃，并于 2026-09-05 经 #113 删除全部相关代码与数据模型。2026-09-05 定案：不再为 runtime 寻找产品域，作品就是 runtime 本身，第一个用户是用户自己，参照物为 Codex 与 DeepSeek Harness；下一批子系统只在真实使用卡住或缺口被明确命中时立项。协作方式见 `CLAUDE.md`（Claude 单角色流程）与 `AGENTS.md`（GPT + Codex 双角色流程）。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、当前学习阶段与方向定案 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板和状态事实来源 |
| [失败 Sampling 部分响应可观测性](./tasks/failed-sampling-debug-capture.md) | Completed：#98 / PR #100 / `915315b` |
| [DeepSeek 思考强度与 Usage](./tasks/deepseek-reasoning-usage.md) | Completed：#94 / PR #95 / `2266fad` |
| [Article Chunking 模块组织](./tasks/article-chunking-module-organization.md) | Completed：#103 / PR #107 |
| [Retrieval 模块组织](./tasks/retrieval-module-organization.md) | Completed：#104 / PR #108 |
| [Phase 8 归档](./tasks/completed/phase-08-grounded-retrieval.md) | Completed：Task 0-3C 全部内容、阶段不变量与边界 |
| [Grounded Answer / Citation 研究](./research/phase-08-grounded-answer-citation-design.md) | Provider、开源方案与架构定案 |
| [Phase 7 归档](./tasks/completed/phase-07-context-engineering.md) | Context Engineering 最终能力与边界 |
| [Phase 6 归档](./tasks/completed/phase-06-bounded-agent-loop.md) | Agent Loop、deadline、终态可靠性 |
| [Admin Console](./tasks/admin-console.md) | Admin Observability 支线 |
| [development-workflow.md](./development-workflow.md) | GPT + Codex 双角色流程；Claude 单角色流程见 `CLAUDE.md` |
| [research/README.md](./research/README.md) | 参照物研究入口：codex-reference、DeepSeek Harness，不代表实现状态 |
| [research/learning-roadmap/learning-method.md](./research/learning-roadmap/learning-method.md) | 每个子系统的七步法与阶段产物 |
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
  -> codex-reference：durability-recovery、safety-permission
  -> DeepSeek Harness：session、interaction
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
- Active 必须有 Issue（GPT + Codex 流程还需 Gate READY）；
- Completed 必须有验收记录：Claude 流程为 PR 逐条验收 PASS 并合并，GPT + Codex 流程为 GPT 技术验收加用户确认；
- 研究文档不能替代任务规格；
- 候选子系统未立 Issue 前不进入实现；Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不自动启动。
