# Admin Console

本文记录 Agent Runtime Console 的独立 Observability 支线。

状态：**Task 0-3、Enhancement 1-3、Phase 8 Task 3C Completed；Task 4 Planned**。

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
| Task 2 | Completed | 真实 Run / Step 只读 API | #33 / #34 / [文档](./completed/admin-console/task-02-run-query-api.md) |
| Task 3 | Completed | 真实 Run Trace UI | #35 / #36 / [文档](./completed/admin-console/task-03-real-trace-ui.md) |
| Enhancement 1 | Completed | 紧凑 Run Trace Workspace | #51 / #53 / `159e964c` / [文档](./completed/admin-console/enhancement-01-run-trace-workspace.md) |
| Phase 8 Task 3C | Completed | Retrieval / Finalization / Citation Inspector | #62 / #63 / `20f838fb` / [文档](./completed/phase-08-grounded-retrieval.md) |
| Enhancement 2 | Completed | 会话记录入口（会话列表 / transcript / 会话内 runs） | #88 / #89 / `e059cebb` / [文档](./completed/admin-console/enhancement-02-conversations-entry.md) |
| Enhancement 3 | Completed | Overview 数据仪表盘（Token/调用/模型/工具统计 + 余额） | #90 / #91 / `3108a5f` / [文档](./completed/admin-console/enhancement-03-overview-dashboard.md) |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 未创建 |

## 已完成基线

### Run Query 与 Trace

- `GET /api/admin/runs`；
- `GET /api/admin/runs/:runId`；
- server-side pagination / filters / stable ordering；
- known Step typed projection；Generic 只用于未知 `type`（#126 起字段非法不再整步降级为 Generic）；
- RUNNING / COMPLETED / FAILED / ABORTED；
- stale-response fencing；
- 服务端 Safe Raw 投影（`safeRawData`）已于 #126 删除；Generic Inspector 只把未知 Step 的白名单字段渲染成 JSON。

### Run Trace Workspace

```text
Compact Header
Duration Overview
Request Boundary
Event / Content Ledger
Typed Inspector / Generic Inspector
```

保留 Messages、搜索、折叠、选中态和桌面响应式布局（Safe Raw tab 只剩 Generic Inspector 一处，见上）。

### Context Inspector

展示每次 sampling 的 outcome、模型标识（resolvedModel / providerId / modelId）、输入预算与估算输入 Token，不暴露完整 model-visible Context；「Sources」分区与 History / Observation 调整计数已于 #149 删除。

### Retrieval Inspector

```text
Run / Steps / MessageGrounding
  -> typed bounded projector
  -> Retrieval Overview / Calls
  -> Grounded Finalization
  -> Citation Ledger / correlation
  -> Event / Retrieval switch
```

当前行为（#126 起）：

- 投影逐字段「能读就读、读不出就 null」，不再有 `available / partial / unavailable / not_applicable` 这类投影可用性状态，也不做跨字段、跨 Step 复核；
- `citations` 只在 COMPLETED 助手消息带合法 Grounding 时有值，缺失或损坏为 null；
- 证据身份数在引用未完整记录时显示「未记录」（PR #130）；
- Prompt、reasoning、embedding、SQL、正文、secret 不进入 API / DOM。

Task 3C 收口时的最终验证：Admin API tests 136、Grounding 168、DB integration 17、Chromium 12、repeat-each=3 为 36，均通过。

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

保持 Planned。触发为「第一个同事要用」（2026-09-23 用户决定，局域网可达本身不算；此前只做低成本加固，另立 Issue）。当前 Admin Console 仍不等于可直接公网暴露的生产后台。

Task 4 启动前需要重新讨论：

- 登录与 Session；
- Role / Permission；
- 用户与团队边界（多租户已否决，见 `docs/research/workbench-direction.md` 第 9 节）；
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
