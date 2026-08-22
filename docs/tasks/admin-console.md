# Admin Console

本文记录 Agent Runtime Console 的独立 Observability 支线。

状态：**Task 0-3、Enhancement 1-2、Phase 8 Task 3C Completed；Task 4 Planned**。

Admin Console 面向项目开发、调试和运行过程复盘。它是 Agent 主线事实的安全投影，不为了展示反向污染 Runtime Domain Model。

## 产品目标

长期用于查看：

- `AgentRun` 与 `AgentStep`；
- model sampling；
- Tool Call / Tool Execution / Observation 安全投影；
- Context Budget 与调整；
- Retrieval candidate / evidence / Citation；
- Grounded finalization；
- 用户可见 Message；
- 错误、时长与 Token Usage；
- 后续 Approval / Recovery 等运行事实。

## 技术基线

- `apps/admin`：Vue 3 / Vite / TypeScript / Pinia / Ant Design Vue；
- `apps/api`：NestJS 用户 API 与只读 Admin Observability API；
- `packages/contracts`：Admin 前后端共享 Read Contract；
- Prisma：Conversation / Message / AgentRun / AgentStep / MessageGrounding 持久化事实；
- Admin View Model 与 Prisma Model 分层；
- Vben 只作为视觉语言参考，不引入其运行时依赖。

## 当前任务看板

| Task | 状态 | 目标 | GitHub / 文档 |
| --- | --- | --- | --- |
| Task 0 | Completed | Admin 前端基础壳 | #19 / #20 |
| Task 1 | Completed | 静态 Run List / Run Detail | #21 / #22 |
| Task 2 | Completed | 真实 Run / Step 只读 API | #33 / #34 / [文档](./admin-console/task-02-run-query-api.md) |
| Task 3 | Completed | 真实 Run Trace UI | #35 / #36 / [文档](./admin-console/task-03-real-trace-ui.md) |
| Enhancement 1 | Completed | 紧凑 Run Trace Workspace | #51 / #53 / `159e964c` / [文档](./admin-console/enhancement-01-run-trace-workspace.md) |
| Phase 8 Task 3C | Completed | Retrieval / Finalization / Citation Inspector | #62 / #63 / `20f838fb` / [文档](./completed/phase-08-grounded-retrieval.md) |
| Enhancement 2 | Completed | 会话记录入口（会话列表 / transcript / 会话内 runs） | #88 / #89 / `e059cebb` / [文档](./admin-console/enhancement-02-conversations-entry.md) |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 未创建 |

## 已完成基线

### Run Query 与 Trace

- `GET /api/admin/runs`；
- `GET /api/admin/runs/:runId`；
- server-side pagination / filters / stable ordering；
- known Step typed projection 与 unknown / malformed Generic fallback；
- RUNNING / COMPLETED / FAILED / ABORTED；
- stale-response fencing；
- Safe Raw bounded projection。

### Run Trace Workspace

```text
Compact Header
Duration Overview
Request Boundary
Event / Content Ledger
Typed Inspector / Generic Inspector
```

保留 Messages、搜索、折叠、选中态、Safe Raw 和桌面响应式布局。

### Context Inspector

展示每次 sampling 的 Budget、Sources、History / Observation 调整和 outcome，不暴露完整 model-visible Context。

### Retrieval Inspector

```text
Run / Steps / MessageGrounding
  -> typed bounded projector
  -> Retrieval Overview / Calls
  -> Grounded Finalization
  -> Citation Ledger / correlation
  -> Event / Retrieval switch
```

状态包括：

- `available / partial / unavailable / not_applicable`；
- zero-hit 与候选数量未知分离；
- exact known Tool、discovery-only 和 unclassifiable Tool 分离；
- malformed Tool summary / finalization / Grounding fail closed；
- failed Tool refs 不参与 Citation correlation；
- Prompt、reasoning、embedding、SQL、正文、secret 不进入 API / DOM。

最终验证：Admin API tests 136、Grounding 168、DB integration 17、Chromium 12、repeat-each=3 为 36，均通过。

## 当前 Observability Baseline

```text
Agent Runtime durable trace
        ↓
Admin Read Contract / Query API
        ↓
Run List / Run Detail
        ↓
Run Trace Workspace
        ↓
Context / Tool / Message / Retrieval / Finalization Inspector
        ↓
开发者可复盘的安全 Console
```

## Task 4：登录、权限与敏感信息脱敏

保持 Planned。当前 Admin Console 仍不等于可直接公网暴露的生产后台。

Task 4 启动前需要重新讨论：

- 登录与 Session；
- Role / Permission；
- 多租户边界；
- API 权限；
- 更严格的敏感字段治理；
- 部署与审计要求。

## 后续演进原则

```text
HITL       -> Approval Inspector
Recovery   -> Attempt / Checkpoint Inspector
MCP / Tool -> Tool / MCP Inspector
Evaluation -> Quality / Judge Inspector
```

每个能力只增加对应安全 projection / Inspector。Phase 8 完成不自动启动 Task 4 或其它后续功能。
