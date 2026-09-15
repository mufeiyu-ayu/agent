# AI SEO Agent Docs

本目录负责文档导航。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-8：Completed
Active Agent Task：无
方向：当前继续本项目源码学习；学完后由 AI 以 Pi 为参照实现云端 Agent，用户不读 Pi 代码（2026-09-15）
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

Phase 8 之后的横向任务 #92、#94、#98 与 Backend 模块组织 #101-#104 均已验收合并；翻译质检站 A-1（#109）/ A-2（#111）曾合入 master，该方向于 2026-09-02 放弃，并于 2026-09-05 经 #113 删除全部相关代码与数据模型。2026-09-05 定案为 runtime 深化；2026-09-15 用户指定完成当前源码学习后，由 AI 以 Pi 为主要参照实现云端 Agent（用户不读 Pi 代码，素材给 AI 用），研究入口为 [pi-reference](./research/pi-reference/README.md)，旧Codex研究资料已按用户要求删除。研究路线不改变已建 Issue 状态，也不自动启动重构。协作方式以 `AGENTS.md` 为准，多角色分工流程见 [development-workflow.md](./development-workflow.md)，工具专属配置保留在对应适配文件。

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
| [development-workflow.md](./development-workflow.md) | 多角色分工流程（规划 / 验收与本地实现分开）；默认的单角色流程见 `AGENTS.md` 5.1 |
| [research/README.md](./research/README.md) | Pi 参照入口与项目研究，不代表实现状态 |
| [research/pi-reference/README.md](./research/pi-reference/README.md) | 全仓研究、AI 使用说明、术语表、8张交互图和云端实现路线 |
| [research/pi-reference/learning-method.md](./research/pi-reference/learning-method.md) | 参照实现的六问与每步产物 |
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
  -> 完成当前链路学习后：按 pi-reference roadmap 的 R0→R2→R1→R3→R4→R5 实现（Pi 素材由 AI 查阅，不含终端/provider）
  -> 云端重构按具体问题讨论；其他实现按需对照
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
- Active 必须有 Issue（多角色分工流程还需 Gate READY）；
- Completed 必须有验收记录：单角色流程为 PR 逐条验收 PASS 并合并，多角色分工流程为另一侧技术验收加用户确认；
- 研究文档不能替代任务规格；
- 候选子系统未立 Issue 前不进入实现；Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不自动启动。
