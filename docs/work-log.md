# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-6 Completed；当前无 Active Agent Task | 完成 Observability Baseline 后再讨论下一正式 Agent 阶段 |
| Phase 6 | 已完成并归档 | 见 `docs/tasks/completed/phase-06-bounded-agent-loop.md` |
| Admin Console | Task 0-2 Completed；Task 3 Next；Task 4 Planned | 创建并实现 Task 3 Real Trace UI |
| 文档结构 | `roadmap`、`tasks`、`research`、`work-log` 为主入口；Completed 阶段统一归档 | 不维护第二套阶段状态 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-09 | Admin Console Task 2 最终验收 | GPT 基于 PR #34 最新 head `f03507f7cc`、Issue #33、完整 diff、15 项测试、真实 PostgreSQL HTTP smoke 与 Codex Review 验收通过；用户明确确认验收 |
| 2026-08-09 | PR #34 合并 / Issue #33 Closed | Task 2 真实 Run / Step Query API 合入 `master`；merge commit `997d6b84341ad3a53e42786490361ea3f984bf7e`；Issue #33 自动关闭为 Completed |
| 2026-08-09 | Admin Console Task 3 定案 | Task 3 提升为 Next；真实浏览器验收强制使用 Computer Use，至少提供 4 张关键截图；Task 3 不修改 Task 2 API Contract、Runtime 或 Prisma schema |
| 2026-08-09 | Admin Console Task 2 实现 | 新增真实 Run 列表 / 详情只读 API、共享 Read Contract、严格 Step allowlist 与 generic safe fallback；`test:admin-runs` 15 项、API / workspace typecheck、API lint 与真实 PostgreSQL HTTP smoke 通过 |
| 2026-08-09 | Admin Console Task 2 / 3 任务拆分 | 新增两个独立 TDD 任务：Task 2 真实 Run / Step 查询 API、Task 3 真实 Trace UI；明确 Task 2 -> Task 3 顺序 |
| 2026-08-09 | Admin Observability 架构决策 | Admin Read Model 与 Prisma Model 分层；不伪造 resolved model；Timeline 支持 unknown future Step generic safe projection；后台展示不反向污染 Runtime |
| 2026-08-09 | PR #32 合并 / Issue #31 Closed | Phase 6 Runtime reliability 合入 `master`；merge commit `691efbcd927682d2a435c2bd6125225ae27a18fb` |
| 2026-08-08 | PR #30 合并 / Issue #29 Closed | Phase 6 bounded sequential Agent Loop 正式收口；merge commit `904b011d64e1aec7e36f706150fb8ef5ef89a761` |
| 2026-07-26 | PR #28 合并 / Issue #27 Closed | 统一输入、历史、Model Profile、输出 / timeout / Observation 预算治理 |
| 2026-07-26 | PR #26 合并 / Issue #25 Closed | Tool 目录整理为 `core/ + articles/`，新增 `get_article_detail` |
| 2026-07-20 | PR #22 合并 | Admin Console Task 1 完成 |
| 2026-07-19 | PR #20 合并 | Admin Console Task 0 完成 |

## 当前阶段边界

Phase 6 已完成，不再继续向该阶段追加新 Agent 能力。

当前 Admin Console 是独立 Observability 支线：

```text
Task 2：Read API       Completed
Task 3：Real Trace UI  Next
Task 4：Auth / RBAC    Planned
```

Task 3 的 Computer Use 浏览器验收和截图证据是正式验收的一部分；自动测试不能替代这一项。

Admin 支线不会自动成为 Phase 7，也不改变 Agent 主线当前“无 Active Task”的状态。

以下能力若后续启动，需要重新创建独立 Task / Issue：

- RAG / Embedding / Vector DB；
- Context compaction / 长期 Memory；
- 写工具、Permission、Approval、HITL；
- Durable Recovery / Resume；
- MCP / Plugin / Skill；
- Multi-agent；
- 并行 Tool Call / Planner / Workflow DSL。

## 记录规则

- 只记录已经真实发生的事项；
- 实现、验收、Task 收口、Draft 转 Ready、合并与开始下一 Task 是不同动作；
- 长期研究进入 `docs/research/**`；
- 旧阶段细节不在这里重复维护。