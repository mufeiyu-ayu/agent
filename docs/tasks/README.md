# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **无 Active Task** | [roadmap.md](../roadmap.md) | 阶段 1-6 已完成；下一正式 Agent 阶段尚未确定 |
| 阶段 6：有界单 Agent Loop | Completed | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | Task 0、横向配置治理、Task 1、Task 2 均已验收并合并 |
| Admin Console Task 0-1 | Completed | [admin-console.md](./admin-console.md) | 基础壳与静态 Run UI 已完成 |
| Admin Console Task 2 | **Active** | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | Issue #33；真实 Run / Step 只读查询 API；Clarification Gate READY |
| Admin Console Task 3 | Planned | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | 等 Task 2 Completed 后创建 Issue；接入真实 Trace UI |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | 登录、权限与敏感信息脱敏；当前不启动 |
| 阶段 5：最小 Tool Calling | Completed | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | 已归档 |
| 阶段 4：Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档 |
| 阶段 3：Streaming | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已归档 |
| 阶段 2：Session Chat | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 已归档 |

## Agent 主线状态

```text
阶段 1-5：Completed
阶段 6：Completed
  Task 0：get_article_detail              Completed
  横向配置治理                            Completed
  Task 1：bounded sequential Agent Loop   Completed
  Task 2：Runtime reliability             Completed

当前：无 Active Agent Task
下一阶段：尚未定案
```

Phase 6 最终交付包括 policy 驱动的 bounded sequential Agent Loop、双 Article Tool、DeepSeek thinking continuation、Run deadline、数据库 remaining-budget / statement timeout、late-result ownership fencing 与原子终态收口。

阶段 6 的详细事实统一查看 [`completed/phase-06-bounded-agent-loop.md`](./completed/phase-06-bounded-agent-loop.md)，不再在 active tasks 区维护 Task 0、Task 1、Task 2 或横向配置治理的重复状态。

下一项正式 Agent 主线任务仍必须重新基于最新 `master`、学习收益和产品需求讨论后确定；`docs/research/**` 的候选路线不会自动变成正式 Agent Phase。

## Admin Console 当前顺序

```text
Task 2：真实 Run / Step Query API   Active / Issue #33
  -> 验收与收口
  -> Task 3：真实 Run Trace UI      Planned
  -> 建立 Observability Baseline
```

Admin Console 是独立 Observability 支线，不自动改写 Agent 主线阶段编号。Task 2 与 Task 3 必须分别使用独立 Issue / PR；Task 2 未 Completed 前不得启动 Task 3。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Next | 已确认是下一项正式任务，但尚未启动 |
| Active | 已创建 Issue 且 Clarification Gate 为 READY，正在实现或待验收 |
| Planned | 方向已记录，前置条件或启动决策尚未满足 |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认收口；合并状态另行记录 |

## 新任务规则

新任务使用 [_template.tdd.md](./_template.tdd.md)，至少写清目标、代码事实、范围、TDD、验收标准、验证命令、风险和 GitHub 交付状态。

完整协作流程见 [`../development-workflow.md`](../development-workflow.md)。