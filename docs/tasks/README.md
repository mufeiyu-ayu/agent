# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里。

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| 阶段 6 Task 1：有界顺序 Agent Loop | **Active** | [phase-06-bounded-agent-loop/README.md](./phase-06-bounded-agent-loop/README.md) | Issue #29 / Draft PR #30；已实现，待验收；PR 尚未合并 |
| 阶段 6 Task 2：可靠性、回归与阶段学习验收 | **Planned** | [phase-06-bounded-agent-loop/README.md](./phase-06-bounded-agent-loop/README.md) | 待 Task 1 验收并合并后基于最新 `master` 编写规格、创建独立 Issue |
| 阶段 6 Task 0：`get_article_detail` | Completed | [phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md](./phase-06-bounded-agent-loop/task-00-get-article-detail-tool.md) | Issue #25 / PR #26 已验收并合并 |
| 横向运行参数治理 | Completed | [runtime-configuration-governance.md](./runtime-configuration-governance.md) | Issue #27 / PR #28 已验收并合并 |
| Admin Console Task 0-1 | Completed | [admin-console.md](./admin-console.md) | 基础壳与静态 Run UI 已完成 |
| Admin Console Task 2-4 | Planned | [admin-console.md](./admin-console.md) | 可并行产品支线，启动时分别创建 Issue |
| 阶段 5 最小 Tool Calling | Completed | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | 已归档 |
| 阶段 4 Agent Runtime | Completed | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档 |
| 阶段 3 Streaming | Completed | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已归档 |
| 阶段 2 Session Chat | Completed | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 已归档 |

## 当前执行顺序

```text
Phase 6 Task 0（Completed）
  -> 横向 Issue #27（Completed）
  -> Phase 6 Task 1（Active；已实现，待验收）
  -> Phase 6 Task 2（Planned；尚未启动）
```

Task 1 的实现、验收确认与 PR 合并是不同动作。当前只完成了实现和 Review 修复，仍待重新验收；PR #30 保持 Draft，未获得转 Ready / 合并授权。

Task 2 保持 `Planned`，不能直接实现。必须先完成 Task 1 验收并等 PR #30 合并到 `master`，再创建正式规格与独立 Issue，并通过 Clarification Gate。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Next | 已确认是下一项正式任务，但尚未启动 |
| Active | 已创建 Issue 且 Gate 为 READY，正在实现或待验收 |
| Planned | 方向已记录，前置条件尚未满足 |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认收口；不等于已经合并 |

## 新任务规则

新任务使用 [_template.tdd.md](./_template.tdd.md)，至少写清：

- 目标、背景与当前代码事实；
- 范围与明确非目标；
- Red / Green / Refactor；
- 可观察验收标准和验证命令；
- 风险与失败语义；
- GitHub 交付与双状态。

完整协作流程见 [`../development-workflow.md`](../development-workflow.md)。
