# Admin Console

本文记录 Agent Runtime Console 的独立产品支线。Task 0 与 Task 1 已完成并通过验收；Task 2 已创建 Issue #33 并进入 Active，Task 3-4 保持 Planned。

Phase 6 Agent Runtime 主线已经完成。Admin Console 不等于下一 Agent 学习阶段；当前先建立真实 Observability 基线，再根据后续 Agent 主线需要持续扩展 Inspector。

## 产品目标

Admin Console 面向项目开发、调试和运行过程复盘，长期用于查看：

- `AgentRun` 与 `AgentStep`；
- model sampling；
- Tool Call、Tool Execution 与 Observation；
- 用户可见 `Message`；
- 受控错误、时长和 Token Usage；
- 后续 Context / Retrieval / Approval / Recovery 等新增运行事实的安全投影。

当前已经完成：

- `apps/admin` 独立后台前端基础壳；
- 静态 Run List / Run Detail；
- 类型化 Mock、Trace、Messages 与 Safe Raw Data；
- 明暗主题、Sidebar、Route Tabs 和列表会话状态。

当前正在进行：

- Task 2：真实 Run / Step 只读查询 API。

当前仍未完成：

- Task 3：真实运行数据接入 Admin UI；
- Task 4：登录、权限与敏感信息脱敏系统。

## 技术基线

- 应用边界：monorepo 内独立应用 `apps/admin`，包名 `@agent/admin`；
- 前端：Vue 3、Vite、TypeScript、Vue Router、Pinia、Ant Design Vue；
- 视觉参考：Vue Vben Admin 5 的 `apps/web-antd`；
- 不引入 `@vben/*` / `@vben-core/*` 运行时依赖；
- Vben MIT License 与改编范围记录在 `apps/admin/THIRD_PARTY_NOTICES.md`。

历史参考源码：

| 项目 | 记录 |
| --- | --- |
| 本地路径 | `/Users/ayu/Desktop/vue-vben-admin` |
| Commit | `0cd87c170f48e17e7d0bc98ed2623f61a2728971` |
| Describe | `v5.7.0-110-g0cd87c170` |
| License | MIT |

## 当前任务看板

| Task | 状态 | 目标 | 文档 | Issue | PR |
| --- | --- | --- | --- | --- | --- |
| Task 0 | Completed | 初始化 Admin 前端基础壳 | 本文归档 | #19 | #20 |
| Task 1 | Completed | 静态 Run List / Run Detail UI | 本文归档 | #21 | #22 |
| Task 2 | **Active** | 真实 Run / Step 只读查询 API | [task-02-run-query-api.md](./admin-console/task-02-run-query-api.md) | #33 | 未创建 |
| Task 3 | Planned | 后台接入真实 Run Trace | [task-03-real-trace-ui.md](./admin-console/task-03-real-trace-ui.md) | 未创建 | 未创建 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 待启动时补独立 Task 文档 | 未创建 | 未创建 |

## 当前执行顺序

```text
Task 2：Admin Run Query API
  -> GPT / 用户验收并收口
  -> Task 3：Real Trace UI
  -> 建立 Observability Baseline
  -> 再进入后续 Agent 主线阶段
```

Task 2 和 Task 3 是两个独立任务，不合并实现。Task 2 未 Completed 前不得创建 Task 3 Issue。

## 已确认架构边界

1. `apps/admin` 复用根 workspace、依赖版本和工程命令，不嵌套 Vben monorepo。
2. Vben 只提供视觉语言和布局参考；业务组件直接使用 Ant Design Vue。
3. Admin Read Model / view model 与 Prisma Model 分层，不把数据库模型直接当 API Contract。
4. `AgentRun` 生命周期、durable `AgentStep` 和用户可见 `Message` 使用不同 UI 投影。
5. Safe Raw Data 只展示 allowlist projection，不包含完整 prompt、Tool arguments / result、Observation、stack、secret 或 chain-of-thought。
6. Task 2 开始后，服务端负责真实分页、筛选、稳定排序与 Trace projection；Task 3 的 Pinia / route state 只维护用户查询上下文，不继续对完整 Mock 数据本地切片。
7. 当前 Recorder 没有可靠保存 provider 最终 resolved model；第一版 Admin API 不做 model filter，`requestedModel=null` 不得被猜成具体模型。
8. Timeline 必须支持 unknown future Step 的 generic safe projection / Inspector，避免后续新增 Context / Retrieval 等 Step 时后台直接失效。
9. Task 4 才处理后台登录、权限和公网敏感信息边界；Task 2-3 默认只用于本地或受控开发环境。
10. Phase 6 已形成多次 sampling / Tool Execution、DB deadline 与 terminalization 新语义；Task 2/3 以当前最新 Runtime durable facts 为事实源，不继续沿用阶段 5 Mock 假设。

## Task 0：后台前端基础壳

核心交付：

- 新增 `apps/admin`；
- Sidebar、Header、Breadcrumb、Route Tabs、Page Content、404；
- `light / dark / system` 主题与 Sidebar 折叠持久化；
- Admin 独立 dev、typecheck、lint、test、build 命令与第三方许可说明。

交付记录：Issue #19 / PR #20，merge commit `09ab8344b772783d6c502d8502cff5a29276517b`。

## Task 1：静态 Run List / Run Detail UI

核心交付：

- `/runs` 汇总指标、本地筛选、Demo Run、状态 Tag、表格和分页；
- `/runs/:runId` 的 Run Overview、Trace、Messages 与 Safe Raw Data；
- ordinary success、tool success、running、failed、aborted 五类确定性 Mock；
- Run List 会话级筛选 / 分页状态；
- 亮色、暗色、Sidebar 展开 / 折叠和常见桌面宽度适配。

Task 1 的静态 Mock 是当时的展示基线，不代表当前 Phase 6 Runtime 的完整真实 Trace。Task 2 已按最新 Phase 6 Recorder / DB 事实重新定义 Read Contract，不把旧 Mock 反向当作服务端规范。

交付记录：Issue #21 / PR #22；最终验收基线 `c9180f6af1f0df4902645ea5debcd07f01784f33`，合并前 head `9d548df4c591414e4a50079a977622d31fe070d6`。

## Task 2：真实 Run / Step 只读查询 API

正式任务文档：[`admin-console/task-02-run-query-api.md`](./admin-console/task-02-run-query-api.md)。

当前状态：

```text
Issue #33：Open
Clarification Gate：READY
看板：Active
实施状态：未开始
验收状态：未验收
```

核心边界：

- `GET /admin/runs`；
- `GET /admin/runs/:runId`；
- `@agent/contracts` 共享 Admin Read Contract；
- `AgentRun + AgentStep + Message` 安全聚合；
- server-side pagination / filters / stable ordering；
- 五类 Phase 6 Step typed projection + unknown generic projection；
- 不改 Prisma schema / Runtime；
- 不接 Admin Vue；
- 不做登录 / 权限；
- 不伪造 resolved model。

## Task 3：真实 Run Trace UI

正式任务文档：[`admin-console/task-03-real-trace-ui.md`](./admin-console/task-03-real-trace-ui.md)。

当前状态：**Planned**。

只有 Task 2 已实现、GPT 技术验收通过、用户确认收口并合并到 `master` 后，才创建 Task 3 Issue。

核心目标：

- `/runs` 从 Mock 切换为真实 server list；
- `/runs/:runId` 从 Mock 切换为真实 Run Detail；
- loading / empty / error / 404 / retry；
- RUNNING partial trace；
- server-side pagination / filters；
- known Step Inspector + unknown Generic Inspector；
- 保留列表筛选、分页和导航上下文。

## Task 4：登录、权限与敏感信息脱敏

保持 Planned。Task 2-3 只建立本地 / 受控开发环境下的 Observability Console，不宣称已经具备公网安全边界。

## 后续演进原则

Task 2-3 完成后，Admin Console 作为 Agent Runtime 的开发者 Observability Console 随主线增量演进：

```text
Context Engineering -> Context Inspector
RAG / Retrieval      -> Retrieval Inspector
HITL                 -> Approval Inspector
Recovery             -> Attempt / Checkpoint Inspector
MCP / Tool           -> Tool / MCP Inspector
```

每个 Agent Phase 只增加对应的安全 projection / Inspector，不为了后台展示反向污染 Runtime Domain Model。