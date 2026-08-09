# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **无 Active Task** | [roadmap.md](../roadmap.md) | 阶段 1-6 已完成；下一正式 Agent 阶段尚未确定 |
| 阶段 6：有界单 Agent Loop | Completed | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | Task 0、横向配置治理、Task 1、Task 2 均已验收并合并 |
| Admin Console Task 0-1 | Completed | [admin-console.md](./admin-console.md) | 基础壳与静态 Run UI 已完成 |
| Admin Console Task 2 | **Completed** | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | Issue #33 / PR #34；merge `997d6b84`；真实 Run / Step 只读 API 已完成 |
| Admin Console Task 3 | **Active** | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | Issue #35；Gate READY；已实现、待验收；Draft PR 待创建 |
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

下一项正式 Agent 主线任务仍必须重新基于最新 `master`、学习收益和产品需求讨论后确定；`docs/research/**` 的候选路线不会自动变成正式 Agent Phase。

## Admin Console 当前顺序

```text
Task 2：真实 Run / Step Query API   Completed / Issue #33 / PR #34
  -> Task 3：真实 Run Trace UI      Active / 已实现 / 待验收
  -> 建立 Observability Baseline
```

Task 3 的 Clarification Gate 已返回 `READY`；实现、自动验证、Computer Use 开发侧自验收和 4 张截图证据已完成。当前等待 Draft PR 的 Codex Review、GPT 验收和用户确认，不等于 Completed。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Next | 已确认是下一项正式任务，但尚未启动，或 Issue 已创建但仍等待 Clarification Gate |
| Active | 已创建 Issue 且 Clarification Gate 为 READY，正在实现或待验收 |
| Planned | 方向已记录，前置条件或启动决策尚未满足 |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认收口；合并状态另行记录 |

## 新任务规则

新任务使用 [_template.tdd.md](./_template.tdd.md)，至少写清目标、代码事实、范围、TDD、验收标准、验证命令、风险和 GitHub 交付状态。

完整协作流程见 [`../development-workflow.md`](../development-workflow.md)。
