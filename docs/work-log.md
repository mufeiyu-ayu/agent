# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-6 Completed；当前无 Active Agent Task | 基于最新 `master` 讨论下一正式 Agent 阶段 |
| Phase 6 | 已完成并归档 | 见 `docs/tasks/completed/phase-06-bounded-agent-loop.md` |
| Admin Console | Task 0-3 Completed；Observability Baseline 已建立；Task 4 Planned | 后续按 Agent 主线能力增量扩展 Inspector |
| Web Chat | 会话滚动跟随与响应式 UI follow-up 已完成 | 后续仅在出现真实 UX 问题时继续迭代 |
| 文档结构 | `roadmap`、`tasks`、`research`、`work-log` 为主入口 | 不维护第二套阶段状态 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-10 | PR #38 / Issue #37 收口 | Web Chat 会话滚动跟随、原生 viewport、scroll memory 与响应式布局 follow-up 合入 `master`；merge commit `415d740507a29ee4bd9b6a4aa26d9c4fbb9668c1`；Issue #37 Closed |
| 2026-08-10 | PR #36 / Issue #35 收口 | Admin Console Task 3 合入 `master`；merge commit `4c689c4c8a8d3975192d13eb3f5a1c24463fcd7b`；真实 Run Trace UI、Computer Use 验收与截图证据完成；Issue #35 Closed |
| 2026-08-10 | PR #36 范围整理 | 最新分支中混入的独立 Web UI / scroll 改动从 Admin Task 3 中拆出并保留到独立分支，避免一个 PR 同时承载两个 Task；Admin PR 仅保留 Task 3 + 必要 API dev-mode 修复 |
| 2026-08-09 | Admin Task 3 Computer Use 自验收 | 真实 Nest API + Admin Vite + Chrome 覆盖真实列表、终态/运行中 Trace、filters、pagination、404、API error、Generic Inspector、stale response、light/dark、常见桌面尺寸；4 张截图已提交 |
| 2026-08-09 | Admin Task 3 实现 | 真实 Run List / Detail、server filter / pagination、五类 Inspector + Generic、失败态与 stale response fencing 完成；自动验证通过 |
| 2026-08-09 | PR #34 / Issue #33 收口 | Task 2 真实 Run / Step Query API 合入 `master`；merge commit `997d6b84341ad3a53e42786490361ea3f984bf7e` |
| 2026-08-09 | PR #32 / Issue #31 收口 | Phase 6 Runtime reliability 合入 `master`；merge commit `691efbcd927682d2a435c2bd6125225ae27a18fb` |
| 2026-08-08 | PR #30 / Issue #29 收口 | Phase 6 bounded sequential Agent Loop 合入 `master`；merge commit `904b011d64e1aec7e36f706150fb8ef5ef89a761` |
| 2026-07-26 | PR #28 / Issue #27 收口 | 输入、历史、Model Profile、输出 / timeout / Observation 预算治理完成 |
| 2026-07-26 | PR #26 / Issue #25 收口 | Tool 目录整理为 `core/ + articles/`，新增 `get_article_detail` |
| 2026-07-20 | PR #22 合并 | Admin Console Task 1 完成 |
| 2026-07-19 | PR #20 合并 | Admin Console Task 0 完成 |

## 当前阶段边界

Phase 6 已完成，不再继续向该阶段追加新 Agent 能力。

Admin Console 当前状态：

```text
Task 0：Admin shell      Completed
Task 1：Static Trace UI  Completed
Task 2：Read API         Completed
Task 3：Real Trace UI    Completed
Task 4：Auth / RBAC      Planned
```

Task 2 + Task 3 已建立真实 Observability Baseline。Task 4 不自动启动，Admin 支线也不自动成为 Phase 7。

当前 Agent 主线保持“无 Active Task”。下一阶段需要重新基于最新 `master` 评估：

- Context Engineering / ContextPlan / Compaction；
- RAG / Embedding / Hybrid Retrieval；
- 写工具、Permission、Approval、HITL；
- Durable Recovery / Resume；
- MCP / Plugin / Skill；
- Planner / Workflow / 并行 Tool Call；
- Multi-agent。

## 记录规则

- 只记录已经真实发生的事项；
- 实现、验收、Task 收口、合并与开始下一 Task 是不同动作；
- 长期研究进入 `docs/research/**`；
- 旧阶段细节不在这里重复维护。
