# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-6 Completed；Phase 7 Context Engineering Active；Task 0 Completed；Task 1 Active / 已实现，待验收 | 验收 Issue #42 / Draft PR #43 |
| Phase 6 | 已完成并归档 | 见 `docs/tasks/completed/phase-06-bounded-agent-loop.md` |
| Phase 7 | Task 0 Completed；Task 1 Active；Task 2-3 Planned；Compaction Gated | Task 1 验收前不启动 Task 2 |
| Admin Console | Task 0-3 Completed；Observability Baseline 已建立；Task 4 Planned | Phase 7 Task 3 再按需增量增加 Context Inspector |
| Web Chat | 会话滚动跟随与响应式 UI follow-up 已完成 | 后续仅在出现真实 UX 问题时继续迭代 |
| 文档结构 | `roadmap`、`tasks`、`research`、`work-log` 为主入口 | 不维护第二套阶段状态 |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-10 | Issue #42 / Draft PR #43 / Phase 7 Task 1 实现 | Q-01～Q-03 全部回写后 Clarification Gate 为 READY；完成 model-aware initial Context Budget、DeepSeek V4 官方 encoding 一致性验证、动态 History keyset 分页与安全 Context summary；指定回归、API lint/typecheck 与 workspace typecheck 通过；Draft PR #43 已创建，当前实施状态已实现、验收状态待验收 |
| 2026-08-10 | PR #41 / Issue #40 收口 | Phase 7 Task 0 `Context Boundary & Snapshot` 经 GPT 技术验收通过，用户明确确认验收；Codex Review 两项 finding 均完成处理；PR #41 按授权转 Ready 并合入 `master`，merge commit `415e866af4d4007b6bed43cd1f6e3df590575706`；Issue #40 Closed；Task 0 Completed |
| 2026-08-10 | Issue #40 / Phase 7 Task 0 实现 | 第二轮 Clarification Gate 为 READY；新增单次 Run 内存 Context Boundary 与 whitelist 安全 Snapshot，锁定 direct-final、一次 Tool、两次顺序 Tool 的 Provider-facing input；Issue 指定测试、API lint/typecheck 与 workspace typecheck 全部通过；PR #41 创建并进入待验收状态 |
| 2026-08-10 | Phase 7 Context Engineering 路线定案 | 基于 Phase 6 Runtime 与现有 Context 限制，确认 Context Engineering 为下一 Agent 主线；Task 0 Context Boundary & Snapshot 为 Next；Task 1-3 Planned；Minimal Compaction 仅作为有证据才启动的 Gated follow-up |
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

Phase 7 当前状态：

```text
Phase 7：Context Engineering          Active
Task 0：Context Boundary & Snapshot   Completed / #40 / #41 / merge 415e866a
Task 1：Model-aware Budget            Active / #42 / Draft PR #43 / 已实现，待验收
Task 2：Loop-aware Context            Planned
Task 3：Context Inspector             Planned
Compaction                            Gated
Active Agent Task                     Task 1 / #42 / Draft PR #43
```

Phase 7 的核心目标是让 model-visible context 从“固定 History 条数 + 各 Tool 局部字符限制”升级为统一 Context boundary、model-aware budget、动态 History Selection、多轮 Loop Context Governance 和安全 Inspector。

Task 1 已通过 Clarification Gate 并完成实现，当前等待 Draft PR 技术验收；未经验收与用户确认，不标记 Completed。

Minimal Compaction 不自动启动；只有 Task 1-3 的真实指标证明动态选择不足以维持长会话连续性、成本、延迟或质量时，才重新讨论独立 Task / Issue。

Admin Console 当前状态：

```text
Task 0：Admin shell      Completed
Task 1：Static Trace UI  Completed
Task 2：Read API         Completed
Task 3：Real Trace UI    Completed
Task 4：Auth / RBAC      Planned
```

Task 2 + Task 3 已建立真实 Observability Baseline。Phase 7 Task 3 可以在这个基线上增加 Context Inspector，但 Admin Task 4 不自动启动。

## 记录规则

- 只记录已经真实发生的事项；
- 实现、验收、Task 收口、合并与开始下一 Task 是不同动作；
- 长期研究进入 `docs/research/**`；
- 旧阶段细节不在这里重复维护。
