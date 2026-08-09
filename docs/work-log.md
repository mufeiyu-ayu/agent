# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-6 Completed；当前无 Active Agent Task | 完成 Observability 基线后再讨论下一正式 Agent 阶段 |
| Phase 6 | 已完成并归档 | 见 `docs/tasks/completed/phase-06-bounded-agent-loop.md` |
| Phase 6 Task 2 | Issue #31 Closed / PR #32 Merged；merge commit `691efbcd927682d2a435c2bd6125225ae27a18fb` | 已收口 |
| Admin Console | Task 0-1 Completed；Task 2 Active / 已实现、待验收 / Issue #33 / PR #34 Ready；Task 3-4 Planned | 先验收并收口 Task 2，再启动 Task 3 Real Trace UI |
| 文档结构 | `roadmap`、`tasks`、`research`、`work-log` 为主入口；Completed 阶段统一归档 | 不维护第二套阶段状态 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-09 | Admin Console Task 2 实现 | 新增真实 Run 列表 / 详情只读 API、共享 Read Contract、严格 Step allowlist 与 generic safe fallback；15 项定向测试、API / workspace typecheck、API lint 和真实 PostgreSQL HTTP smoke 通过；PR #34 Ready，当前待验收 |
| 2026-08-09 | Admin Console Task 2 / 3 任务拆分 | 在 `docs/tasks/admin-console/` 新增两个独立 TDD 任务：Task 2 真实 Run / Step 查询 API、Task 3 真实 Trace UI；明确 Task 2 -> Task 3 顺序，不合并实现 |
| 2026-08-09 | Admin Console Issue #33 创建 | Task 2 `真实 Run / Step 只读查询 API` 进入 Active；Clarification Gate READY；Task 3 继续 Planned |
| 2026-08-09 | Admin Observability 架构决策 | Admin Read Model 与 Prisma Model 分层；第一版不伪造 resolved model、不做 model filter；Timeline 支持 unknown future Step generic safe projection；Task 2-3 不修改 Runtime / Prisma schema |
| 2026-08-09 | Issue #31 Closed | Phase 6 Task 2 GitHub 交付流程正式结束 |
| 2026-08-09 | PR #32 最终技术验收 | GPT 基于最新 head `76f82a42`、Issue #31、完整 diff、测试与 PostgreSQL 实证验收通过；无阻塞 P0 / P1 / P2 finding |
| 2026-08-09 | PR #32 合并 | Phase 6 Task 2 Runtime reliability 合入 `master`；merge commit `691efbcd927682d2a435c2bd6125225ae27a18fb` |
| 2026-08-09 | Task 2 DB reliability | Tool Loop 39、Model Stream 54、Recorder 14、Tools 40、SEO 10、DB Reliability 11 项全部记录通过；API / Web / workspace typecheck、API lint、`git diff --check` PASS |
| 2026-08-09 | Task 2 关键可靠性收口 | 单一 Run deadline、remaining-budget DB boundary、PostgreSQL statement / lock timeout、late-result fencing、原子 completion / terminalization 与 COMMIT outcome unknown 语义建立 |
| 2026-08-09 | Phase 6 文档归档 | Task 0、横向配置治理、Task 1、Task 2 合并为 `docs/tasks/completed/phase-06-bounded-agent-loop.md`；active tasks 区仅保留旧链接兼容入口 |
| 2026-08-08 | PR #30 合并 / Issue #29 Closed | Phase 6 Task 1 正式收口；merge commit `904b011d64e1aec7e36f706150fb8ef5ef89a761` |
| 2026-08-08 | PR #30 最终重新验收 | 补齐 DeepSeek assistant Tool Call 非 null `content` 与 SEO 双工具指引；Tool Loop 34、Model Stream 49、Tools 33、SEO 10、Recorder 9、LLM Config 17 个测试记录通过 |
| 2026-07-26 | PR #28 合并，Issue #27 Closed | 统一 64K 输入、40 条 Completed 历史、DeepSeek Model Profile、应用输出策略、请求超时和分级 Tool Observation 预算 |
| 2026-07-26 | PR #26 合并，Issue #25 Closed | Tool 目录整理为 `core/ + articles/`，新增 `get_article_detail` |
| 2026-07-20 | PR #22 合并 | Admin Console Task 1 完成 |
| 2026-07-19 | PR #20 合并 | Admin Console Task 0 完成 |

## 当前阶段边界

Phase 6 已完成，不再继续向该阶段追加新 Agent 能力。

当前 Admin Console Task 2-3 是独立 Observability 支线：

```text
Task 2：Read API -> Active / Issue #33
Task 3：Real Trace UI -> Planned
```

它们不会自动成为 Phase 7，也不改变 Agent 主线当前“无 Active Task”的状态。

以下能力若后续启动，需要重新创建独立 Task / Issue，而不是作为 Phase 6 尾项继续扩张：

- RAG / Embedding / Vector DB；
- Context compaction / 长期 Memory；
- 写工具、Permission、Approval、HITL；
- Durable Recovery / Resume；
- MCP / Plugin / Skill；
- Multi-agent；
- 并行 Tool Call / Planner / Workflow DSL。

## 记录规则

- 只记录已经真实发生的事项。
- 实现、验收、Task 收口、Draft 转 Ready、合并与开始下一 Task 是不同动作。
- 长期研究进入 `docs/research/**`。
- 旧阶段细节不在这里重复维护。
