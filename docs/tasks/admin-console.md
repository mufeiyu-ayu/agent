# Admin Console

本文记录 Agent Runtime Console 的独立 Observability 支线。Task 0-2 已完成；Task 3 是下一正式任务；Task 4 保持 Planned。

Phase 6 Agent Runtime 主线已经完成。Admin Console 不等于下一 Agent 学习阶段；当前先建立真实 Observability Baseline，再根据后续 Agent 主线需要持续扩展 Inspector。

## 产品目标

Admin Console 面向项目开发、调试和运行过程复盘，长期用于查看：

- `AgentRun` 与 `AgentStep`；
- model sampling；
- Tool Call、Tool Execution 与 Observation 的安全投影；
- 用户可见 `Message`；
- 受控错误、时长和 Token Usage；
- 后续 Context / Retrieval / Approval / Recovery 等新增运行事实的安全投影。

## 技术基线

- `apps/admin`：独立 Vue 3 / Vite / TypeScript / Pinia / Ant Design Vue Console；
- `apps/api`：NestJS 服务端，同时提供用户侧 API 与只读 Admin Observability API；
- `packages/contracts`：Admin 前后端共享 Read Contract；
- `prisma`：`Conversation / Message / AgentRun / AgentStep` 持久化事实源；
- Vben 只作为视觉语言参考，不引入 `@vben/*` / `@vben-core/*` 运行时依赖。

## 当前任务看板

| Task | 状态 | 目标 | 文档 | Issue | PR |
| --- | --- | --- | --- | --- | --- |
| Task 0 | Completed | 初始化 Admin 前端基础壳 | 本文归档 | #19 | #20 |
| Task 1 | Completed | 静态 Run List / Run Detail UI | 本文归档 | #21 | #22 |
| Task 2 | **Completed** | 真实 Run / Step 只读查询 API | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | #33 | #34 |
| Task 3 | **Next** | 后台接入真实 Run Trace | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | 待创建 | 待创建 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 待启动时补独立 Task 文档 | 未创建 | 未创建 |

## 当前执行顺序

```text
Task 2：Admin Run Query API      Completed
  -> Task 3：Real Trace UI       Next
  -> 建立 Observability Baseline
  -> 再讨论下一 Agent 主线阶段
```

Task 3 必须使用 Computer Use 做真实浏览器验收，并提交关键状态截图证据。Task 4 不在 Task 3 范围内。

## 已确认架构边界

1. `apps/admin` 是管理后台前端，Admin API 仍位于 `apps/api`；
2. Admin Read Model / view model 与 Prisma Model 分层，不把 ORM Entity 直接当 API Contract；
3. Task 2 已建立 `@agent/contracts` Admin Run Read Contract，Task 3 不重新解析 raw Step JSON；
4. `AgentRun` 生命周期、durable `AgentStep` 和用户可见 `Message` 使用不同 UI 投影；
5. Safe Raw Data 只展示 allowlist projection，不包含完整 prompt、Tool raw arguments / result、Observation、stack、secret 或 chain-of-thought；
6. 服务端负责真实分页、筛选、稳定排序与 Trace projection；Task 3 的 Pinia / route state 只维护用户查询上下文；
7. 当前 Recorder 没有可靠保存 provider resolved model；Admin 不做 model filter，也不把 `requestedModel=null` 猜成具体模型；
8. Timeline 必须支持 unknown future Step 的 generic safe projection / Inspector；
9. 当前 Admin API 无认证，Task 3 只面向本地或受控开发环境；Task 4 才处理登录、权限和公网安全；
10. 后续 Context / RAG / HITL / Recovery 等能力只增量增加对应 Inspector，不为了后台展示反向修改 Runtime Domain Model。

## Task 0：后台前端基础壳

Issue #19 / PR #20，Completed。

核心交付：独立 `apps/admin`、Sidebar / Header / Breadcrumb / Route Tabs、主题、Sidebar 折叠、Overview / Runs 占位页和工程命令。

## Task 1：静态 Run List / Run Detail UI

Issue #21 / PR #22，Completed。

核心交付：

- `/runs` 静态 Run List、汇总、筛选和分页；
- `/runs/:runId` 的 Overview、Trace、Messages、Safe Raw Data；
- ordinary success、tool success、running、failed、aborted Mock；
- 列表会话级筛选 / 分页状态；
- light / dark 和常见桌面尺寸适配。

Task 1 Mock 只是 UI 产品结构基线，不再作为真实 API 事实源。

## Task 2：真实 Run / Step 只读查询 API

正式任务文档：[`admin-console/task-02-run-query-api.md`](./admin-console/task-02-run-query-api.md)。

最终状态：

```text
Issue #33：Closed / Completed
PR #34：Merged
merge commit：997d6b84341ad3a53e42786490361ea3f984bf7e
GPT 技术验收：通过
用户验收：已确认
看板：Completed
```

最终建立：

- `GET /api/admin/runs`；
- `GET /api/admin/runs/:runId`；
- `@agent/contracts` Admin Run Read Contract；
- `AgentRun + AgentStep + Message` 安全聚合；
- server-side pagination / filters / stable ordering；
- 五类 Phase 6 Step typed projection；
- unknown / malformed Step generic safe projection；
- 真实 PostgreSQL HTTP smoke；
- 不改 Prisma schema / Runtime；
- 不伪造 resolved model。

## Task 3：真实 Run Trace UI

正式任务文档：[`admin-console/task-03-real-trace-ui.md`](./admin-console/task-03-real-trace-ui.md)。

当前状态：**Next**。

核心目标：

- `/runs` 从 Mock 切换为真实 server list；
- `/runs/:runId` 从 Mock 切换为真实 Run Detail；
- server-side pagination / filters；
- loading / empty / error / 404 / retry；
- RUNNING partial trace；
- known Step Inspector + Generic Inspector；
- Safe Raw / Messages 直接消费服务端安全 projection；
- 保留筛选、分页、路由返回上下文；
- 处理快速查询 / 路由切换的 stale response；
- 使用 Computer Use 做真实浏览器验收；
- 至少 4 张关键截图随 PR 提供。

Computer Use 主验收不能被自动测试或 Playwright 脚本替代；若 Codex 执行环境没有 Computer Use，本 Task 不得伪报浏览器验收通过，PR 应保持 Draft 并报告阻塞。

## Task 4：登录、权限与敏感信息脱敏

保持 Planned。Task 3 完成仍不代表 Admin Console 已具备公网安全边界。

## 后续演进原则

Task 3 完成后，Admin Console 作为 Agent Runtime 的开发者 Observability Console 随主线增量演进：

```text
Context Engineering -> Context Inspector
RAG / Retrieval      -> Retrieval Inspector
HITL                 -> Approval Inspector
Recovery             -> Attempt / Checkpoint Inspector
MCP / Tool           -> Tool / MCP Inspector
```

每个 Agent Phase 只增加对应安全 projection / Inspector，不为了后台展示反向污染 Runtime Domain Model。