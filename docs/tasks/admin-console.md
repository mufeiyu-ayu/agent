# Admin Console

本文记录 Agent Runtime Console 的独立产品支线。Task 0 与 Task 1 已完成并通过验收；Task 2-4 保持 Planned，当前没有 Active 的 Admin Console 正式任务。

Phase 6 Agent Runtime 主线已经完成。Admin Console 不自动成为下一 Agent 学习阶段；未来启动 Task 2 时必须重新读取当前 Runtime / Trace 结构，而不是继续沿用早期静态 Mock 的阶段 5 假设。

## 产品目标

Admin Console 面向项目开发、调试和运行过程复盘，长期用于查看：

- `AgentRun` 与 `AgentStep`；
- model sampling；
- Tool Call、Tool Execution 与 Observation；
- 用户可见 `Message`；
- 受控错误、时长和 Token Usage。

当前已经完成：

- `apps/admin` 独立后台前端基础壳；
- 静态 Run List / Run Detail；
- 类型化 Mock、Trace、Messages 与 Safe Raw Data；
- 明暗主题、Sidebar、Route Tabs 和列表会话状态。

当前仍未完成：

- Run / Step 只读查询 API；
- 真实运行数据接入；
- 登录、权限与敏感信息脱敏系统。

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

| Task | 状态 | 目标 | Issue | PR |
| --- | --- | --- | --- | --- |
| Task 0 | Completed | 初始化 Admin 前端基础壳 | #19 | #20 |
| Task 1 | Completed | 静态 Run List / Run Detail UI | #21 | #22 |
| Task 2 | Planned | Admin 只读 Run / Step 查询 API | 未创建 | 未创建 |
| Task 3 | Planned | 后台接入真实运行数据 | 未创建 | 未创建 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 未创建 | 未创建 |

## 已确认架构边界

1. `apps/admin` 复用根 workspace、依赖版本和工程命令，不嵌套 Vben monorepo。
2. Vben 只提供视觉语言和布局参考；业务组件直接使用 Ant Design Vue。
3. Admin view model 与 Prisma Model 分层，不把数据库模型直接当未来 API contract。
4. `AgentRun` 生命周期、durable `AgentStep` 和用户可见 `Message` 使用不同 UI 投影。
5. Safe Raw Data 只展示 allowlist 投影，不包含完整 prompt、Tool arguments / result、Observation、stack、secret 或 chain-of-thought。
6. Run List 筛选和分页使用会话级 Pinia Store，不提前定义服务端查询协议。
7. Task 2-3 才接入真实 Run / Step 数据；Task 4 才处理后台登录、权限和敏感信息脱敏。
8. Phase 6 已形成多次 sampling / Tool Execution、DB deadline 与 terminalization 新语义；未来 Task 2 Clarification Gate 必须以当时最新 `master` 重新设计查询投影。

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

Task 1 的静态 Mock 是当时的展示基线，不代表当前 Phase 6 Runtime 的完整真实 Trace。Task 2 接真实查询 API 时必须重新核对多 sampling、多 Tool、DB deadline 和 terminalization 字段。

交付记录：Issue #21 / PR #22；最终验收基线 `c9180f6af1f0df4902645ea5debcd07f01784f33`，合并前 head `9d548df4c591414e4a50079a977622d31fe070d6`。

## 后续规划

- Task 2：设计只读 Run / Step 查询 API；
- Task 3：将静态 Run UI 接入真实查询数据；
- Task 4：补充后台登录、权限控制和敏感信息脱敏。

开始任一后续 Task 前必须创建独立 Issue 并通过 Clarification Gate；不会因为 Phase 6 已完成而自动启动。
