# Admin Console

本文记录 Agent Runtime Console 的独立 Observability 支线。Task 0-3 已完成；Task 4 保持 Planned。

Phase 6 Agent Runtime 主线已经完成。Admin Console 不等于下一 Agent 学习阶段；当前已经建立真实 Observability Baseline，后续根据 Agent 主线能力增量扩展 Inspector。

## 产品目标

Admin Console 面向项目开发、调试和运行过程复盘，长期用于查看：

- `AgentRun` 与 `AgentStep`；
- model sampling；
- Tool Call / Tool Execution / Observation 的安全投影；
- 用户可见 `Message`；
- 受控错误、时长和 Token Usage；
- 后续 Context / Retrieval / Approval / Recovery 等新增运行事实的安全投影。

## 技术基线

- `apps/admin`：Vue 3 / Vite / TypeScript / Pinia / Ant Design Vue；
- `apps/api`：NestJS 服务端，同时提供用户 API 与只读 Admin Observability API；
- `packages/contracts`：Admin 前后端共享 Read Contract；
- Prisma：`Conversation / Message / AgentRun / AgentStep` 持久化事实源；
- Admin View Model 与 Prisma Model 分层；
- Vben 只作为视觉语言参考，不引入 `@vben/*` / `@vben-core/*` 运行时依赖。

## 当前任务看板

| Task | 状态 | 目标 | 文档 | Issue | PR |
| --- | --- | --- | --- | --- | --- |
| Task 0 | Completed | 初始化 Admin 前端基础壳 | 本文归档 | #19 | #20 |
| Task 1 | Completed | 静态 Run List / Run Detail UI | 本文归档 | #21 | #22 |
| Task 2 | Completed | 真实 Run / Step 只读查询 API | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | #33 | #34 |
| Task 3 | **Completed** | 后台接入真实 Run Trace | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | #35 | #36 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 待启动时补独立 Task 文档 | 未创建 | 未创建 |

## Task 0：后台前端基础壳

Issue #19 / PR #20，Completed。

核心交付：独立 `apps/admin`、Sidebar / Header / Breadcrumb / Route Tabs、主题、Sidebar 折叠、Overview / Runs 占位页和工程命令。

## Task 1：静态 Run List / Run Detail UI

Issue #21 / PR #22，Completed。

核心交付：静态 Run List / Detail、Trace / Messages / Safe Raw UI、确定性 Mock、列表会话状态、light / dark 和常见桌面尺寸适配。

Task 1 Mock 只作为早期 UI 产品结构基线，不再作为真实数据源。

## Task 2：真实 Run / Step 只读查询 API

Issue #33 / PR #34，merge commit `997d6b84341ad3a53e42786490361ea3f984bf7e`。

最终建立：

- `GET /api/admin/runs`；
- `GET /api/admin/runs/:runId`；
- `@agent/contracts` Admin Run Read Contract；
- `AgentRun + AgentStep + Message` 安全聚合；
- server-side pagination / filters / stable ordering；
- 五类 Phase 6 Step typed projection；
- unknown / malformed Step generic safe projection；
- 不改 Prisma schema / Runtime；
- 不伪造 resolved model。

## Task 3：真实 Run Trace UI

Issue #35 / PR #36，merge commit `4c689c4c8a8d3975192d13eb3f5a1c24463fcd7b`。

最终完成：

- `/runs` 从 Mock 切换到真实 server list / summary / pagination / filters；
- `/runs/:runId` 使用真实 Run / Step / Message / Safe Raw projection；
- loading / empty / error / retry / 404；
- RUNNING / COMPLETED / FAILED / ABORTED；
- 五类已知 Step 专用 Inspector + Generic Inspector；
- `requestedModel=null` 保持明确未知语义；
- 返回列表保留 query / page / pageSize 上下文；
- AbortController + request / route identity fencing 防止 stale response；
- Admin Vite `/api` proxy；
- API `dev` / `dev:watch` 修复 decorator metadata 与开发重启链路；
- Computer Use 使用真实 Nest API + Vite + Chrome 完成主验收；
- 4 张关键截图证据已提交。

Task 3 GPT 技术验收通过，用户已明确确认并授权合并；Issue #35 Closed / Completed，PR #36 Merged。

## 当前 Observability Baseline

```text
Agent Runtime durable trace
        ↓
Admin Read Contract / Query API
        ↓
Run List / Run Detail
        ↓
Timeline / Typed Inspector / Generic Inspector
        ↓
Computer Use 可验证的开发者 Console
```

这套基线后续用于承接 Agent 主线的新能力，而不是为了后台展示反向污染 Runtime Domain Model。

## Task 4：登录、权限与敏感信息脱敏

保持 Planned。Task 0-3 完成不代表 Admin Console 已具备公网安全边界。

## 后续演进原则

后续 Agent Phase 可按需增量增加：

```text
Context Engineering -> Context Inspector
RAG / Retrieval      -> Retrieval Inspector
HITL                 -> Approval Inspector
Recovery             -> Attempt / Checkpoint Inspector
MCP / Tool           -> Tool / MCP Inspector
```

每个能力只增加对应安全 projection / Inspector；下一 Agent 主线阶段需要基于最新 `master` 重新讨论。
