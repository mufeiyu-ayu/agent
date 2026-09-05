# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里；已完成阶段的详细记录查看对应 Task 文档、`docs/tasks/completed/**`、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Active Agent Task：无
方向：runtime 深化（2026-09-05 定案）
候选子系统：session 事件流与 replay、审批门、compaction、定时任务（未立 Issue）
翻译质检站：已删除（#113；A-1 #109 / A-2 #111 代码与数据模型全部移除）
DeepSeek 思考强度与 Usage（#94）：Completed
Run 配置解析边界（#92）：Completed
失败 Sampling 部分响应可观测性（#98）：Completed
Admin Task 4：Planned
```

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **阶段 1-8 Completed** | [roadmap.md](../roadmap.md) | 当前为源码阅读阶段；方向已定案为 runtime 深化 |
| 翻译质检站 A-1 #109 / A-2 #111 | **已删除 / #113** | Issue #109、#111、#113 | 2026-09-02 方向放弃，2026-09-05 经 #113 删除全部代码、契约、admin 页面与数据模型（drop 迁移 `20260905120000_remove_qa_station`）；仅保留混入的通用 admin 改动 |
| Backend 模块组织 #101 | **Completed / #101 / PR #105** | [agent-runtime-module-organization.md](./agent-runtime-module-organization.md) | Agent Runtime 目录分域 + Cancellation Lifecycle；GPT 验收 + 用户确认 |
| Admin Runs 模块组织 #102 | **Completed / #102 / PR #106** | [admin-runs-module-organization.md](./admin-runs-module-organization.md) | Projector 分域 + 循环依赖消除；GPT 验收 + 用户确认 |
| Article Chunking 模块组织 #103 | **Completed / #103 / PR #107** | [article-chunking-module-organization.md](./article-chunking-module-organization.md) | 稳定 Facade + structural / deterministic / token 内部分层；GPT 验收 + 用户确认 |
| Retrieval 模块组织 #104 | **Completed / #104 / PR #108** | [retrieval-module-organization.md](./retrieval-module-organization.md) | Contract / Runtime、Retrievers、Persistence、Evaluation 分域；GPT 验收 + 用户确认 |
| DeepSeek 思考强度与 Usage（#94） | **Completed / #95 / `2266fad`** | [deepseek-reasoning-usage.md](./deepseek-reasoning-usage.md) | Web 单次选择、Run resolved config、Provider wire、Usage / Admin 闭环 |
| Run 配置解析边界（#92） | **Completed / #93 / `f32cd48`** | [agent-run-configuration.md](./agent-run-configuration.md) | 横向 refactor：单次 Run 配置解析入口 + 配置地图 |
| 失败 Sampling 部分响应可观测性（#98） | **Completed / #100 / `915315b`** | [failed-sampling-debug-capture.md](./failed-sampling-debug-capture.md) | complete / partial / empty 捕获、失败终态保留与 Admin 三态展示 |
| Phase 8：Grounded Retrieval / RAG Baseline | **Completed** | [completed/phase-08-grounded-retrieval.md](./completed/phase-08-grounded-retrieval.md) | Task 0-3C 全部完成，已归档 |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；Minimal Compaction Gated |
| Phase 6：有界单 Agent Loop | **Completed** | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | bounded loop、deadline、终态可靠性 |
| Admin Console Task 0-3 + Enhancement 1 | **Completed** | [admin-console.md](./admin-console.md) | Run / Step API、Run Trace、typed Inspector |
| Phase 8 Task 3C | **Completed** | [Phase 8 归档](./completed/phase-08-grounded-retrieval.md) | #62 Closed / #63 Merged / `20f838fb` |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | Auth / RBAC；当前不启动 |

## Phase 8 Task 看板

Phase 8 全部 Task 文档已合并归档到 [completed/phase-08-grounded-retrieval.md](./completed/phase-08-grounded-retrieval.md)。

| Task | 状态 | 核心结果 |
| --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation | **Completed / #48 / #49 / `4c2f7950`** | Contract、lexical adapter、evaluation baseline |
| Task 1：Article Chunking & Embedding Index | **Completed / #50 / #52 / `76d66abf`** | deterministic Chunk、Embedding boundary、pgvector index |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed / #54 / #55 / `3abdcb8a`** | Gemini、exact vector、Article aggregation、RRF、quality-v2 |
| Task 2B：Retrieval Tool & Agent Integration | **Completed / #56 / #57 / `4f3ba1c1`** | `retrieve_article_context@1`、Observation、Agent Loop |
| Task 3A：Grounded Answer & Citation Backend | **Completed / #58 / #59 / `d6df7ac1`** | finalization、Citation validation、durable Grounding |
| Task 3B：Web Chat Source UI | **Completed / #60 / #61 / `572ad206`** | 状态、Sources disclosure、Source cards、Browser |
| Task 3C：Admin Retrieval Inspector | **Completed / #62 / #63 / `20f838fb`** | typed Retrieval / Finalization / Citation audit |

收口事实（final head、merge、验收与最终验证数据）见 [Phase 8 归档](./completed/phase-08-grounded-retrieval.md)。

## 当前正式动作

当前无 Active Agent Task。2026-09-05 方向定案为 runtime 深化，候选子系统见 [roadmap.md](../roadmap.md)；只在真实使用卡住、源码阅读发现缺陷或缺口被明确命中时建 Issue，走 `CLAUDE.md` 单角色流程。

Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不得自动进入实现。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 已记录方向，但依赖或规格尚未满足启动条件 |
| Next | 已确认是下一项正式任务，或 Issue 已创建但尚未开工 |
| Active | 已创建 Issue（GPT + Codex 流程还需 Gate READY），正在实现或待验收 |
| Gated | 只有客观触发条件满足后才重新讨论 |
| 已放弃 / 已删除 | 方向放弃；代码保留或删除按看板记录 |
| Completed | 已实现且验收通过：Claude 流程为 PR 逐条验收 PASS 并合并，GPT + Codex 流程为 GPT 技术验收加用户确认 |

## 新任务规则

- 一个 Issue 只对应一个明确 Task；
- Planned / Next 文档不能替代正式 Issue；
- Issue 建立前不得修改正式代码；Issue 实质性变化后先更新 Issue 再继续；
- 实现后先写“已实现、待验收”，验收 PASS 后才写“已通过”；
- Completed 必须有验收记录（见状态定义）；
- Claude 流程见 `CLAUDE.md`，GPT + Codex 流程见 [`../development-workflow.md`](../development-workflow.md)。
