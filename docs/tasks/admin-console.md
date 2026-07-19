# Admin Console

本文记录 Agent Runtime Console 的长期建设边界和任务状态。Task 0 与 Task 1 已完成并通过验收；Task 2-4 保持 Planned，尚未启动新的正式实现。

## 目标与产品边界

Admin Console 面向项目开发、调试和运行过程复盘，后续用于查看 `AgentRun`、`AgentStep`、模型 sampling、Tool Call、Tool Execution、Observation、Message 与受控错误信息。

当前已经完成：

- `apps/admin` 独立后台前端基础壳；
- 静态 Run List / Run Detail；
- 类型化 Mock、Trace、Messages 与 Safe Raw Data；
- 明暗主题、Sidebar、Route Tabs 和列表会话状态。

当前仍未完成：

- Run / Step 只读查询 API；
- 真实运行数据接入；
- 登录、权限与敏感信息脱敏系统。

因此，Task 0-1 的完成不代表阶段 8“可观测性与作品集”已经启动或完成；阶段 6、阶段 7、阶段 8 的既有状态保持不变。

## 技术基线

- 应用边界：当前 monorepo 内的独立应用 `apps/admin`，包名为 `@agent/admin`。
- 前端基线：Vue 3、Vite、TypeScript、Vue Router、Pinia、Ant Design Vue。
- 视觉基线：参考 Vue Vben Admin 5 的 `apps/web-antd`，只提取所需视觉和布局能力。
- 依赖边界：不引入 `@vben/*` 或 `@vben-core/*` 运行时依赖，不建立嵌套 workspace 或 lockfile。
- 上游许可：Vben 使用 MIT License；来源、版本与实际改编范围记录在 `apps/admin/THIRD_PARTY_NOTICES.md`。

Vben 本地参考源码：

| 项目 | 记录 |
| --- | --- |
| 路径 | `/Users/ayu/Desktop/vue-vben-admin` |
| Commit | `0cd87c170f48e17e7d0bc98ed2623f61a2728971` |
| Describe | `v5.7.0-110-g0cd87c170` |
| Dirty 状态 | clean |
| License | MIT License，Copyright (c) 2024-present, Vben |

## 当前任务看板

| Task | 状态 | 目标 | Issue | PR | 实施状态 | 验收状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Task 0 | Completed | 初始化 Admin 前端基础壳 | [#19](https://github.com/mufeiyu-ayu/agent/issues/19) | [#20](https://github.com/mufeiyu-ayu/agent/pull/20) | 已实现 | 已通过 |
| Task 1 | Completed | 静态 Run List / Run Detail UI | [#21](https://github.com/mufeiyu-ayu/agent/issues/21) | [#22](https://github.com/mufeiyu-ayu/agent/pull/22) | 已实现 | 已通过 |
| Task 2 | Planned | Admin 只读 Run / Step 查询 API | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 3 | Planned | 后台接入真实运行数据 | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 未创建 | 未创建 | 未开始 | 未验收 |

当前没有 Active 的 Admin Console 正式任务。Task 2-4 开始前仍需分别创建明确 Issue。

## 关键架构决定

1. `apps/admin` 复用当前根 workspace、依赖版本和工程命令，不嵌套 Vben monorepo。
2. Vben 只提供视觉语言和布局参考；业务组件直接使用 Ant Design Vue，不复制完整 `apps/web-antd`，不重建通用组件框架。
3. Task 0 只建立 Sidebar、Header、Breadcrumb、Route Tabs、Page Content、主题、Sidebar 折叠和静态路由。
4. Task 1 使用 Admin 内部 view model 和确定性 Mock，不把 Prisma Model 当作未来 API contract。
5. `AgentRun` 生命周期、durable `AgentStep` 和用户可见 `Message` 使用不同 UI 投影。
6. Tool Calling Mock 保持 `tool_calls -> tool_execution -> stop` 的真实语义。
7. Safe Raw Data 只展示 allowlist 投影，不包含完整 prompt、Tool arguments / result、Observation、stack、secret 或 chain-of-thought。
8. Run List 筛选和分页使用会话级 Pinia Store，不写入 `localStorage`，也不提前定义服务端查询协议。
9. 真实 Run / Step 查询留给 Task 2-3；登录、权限和敏感信息脱敏留给 Task 4。

## Task 0：后台前端基础壳

### 核心产物

- 新增 `apps/admin`，包名 `@agent/admin`。
- 实现 Sidebar、Header、Breadcrumb、Route Tabs、Page Content、404。
- 实现 `light / dark / system` 主题和 Sidebar 折叠持久化。
- 保留 Vben Ant Design 视觉语言，但无 `@vben/*` 运行时依赖。
- 增加 Admin 独立 dev、typecheck、lint、test、build 命令及第三方许可说明。

### 交付记录

- Issue：[#19](https://github.com/mufeiyu-ayu/agent/issues/19)（已关闭）
- PR：[#20](https://github.com/mufeiyu-ayu/agent/pull/20)（已合并）
- Merge commit：`09ab8344b772783d6c502d8502cff5a29276517b`
- 实施状态：已实现
- 验收状态：已通过

## Task 1：静态 Run List / Run Detail UI

### 目标与范围

基于 Issue #21 的视觉参考，将 Runs 占位页升级为可独立演示的 Agent Run Inspector，同时保持当前数据事实和安全边界。

已实现：

- `/runs` 的 4 个汇总指标、本地筛选、8 条 Demo Run、状态 Tag、表格和分页；
- `/runs/:runId` 的 Run Overview、Trace、Messages 和 Safe Raw Data；
- ordinary success、tool success、running、failed、aborted 五类确定性 Mock；
- `RunTimelineItem` 可辨别联合类型；
- AgentRun-derived lifecycle 与 durable AgentStep 的明确区分；
- Tool Calling 两轮 sampling：第一次 `finishReason=tool_calls`，第二次 `finishReason=stop`；
- Safe Raw Data allowlist 投影与禁止字段检查；
- 亮色、暗色、Sidebar 展开 / 折叠和 1280 / 1440 宽度适配。

明确未做：

- 不新增 Admin API；
- 不修改 contracts、Prisma、数据库、Agent Runtime 或 Tool Calling；
- 不实现真实服务端筛选 / 分页、Run replay、retry、resume 或 cancel；
- 不推进 Task 2-4。

### Review finding 修复

GPT 首轮验收与 Codex Review 提出的三个交互问题均已修复：

1. Route Tabs 使用 `resolveRouteTabTitle()` 为不同 Run 生成可辨识标题，例如 `Run · …20260719_01`。
2. `run-detail` 使用 `meta.activeMenu: '/runs'` 保持详情页的 `Runs` 菜单高亮，并设置 `aria-current="page"`。
3. 新增会话级 `run-list.store.ts`，保留 draft / applied filters、日期范围、页码和 page size；Back、Breadcrumb、Route Tab 与浏览器后退返回列表时均复用状态。

原 Codex Review 的三个 Thread 已分别回复并标记 resolved。

### 验证记录

自动验证全部通过：

```bash
pnpm --filter @agent/admin typecheck
pnpm --filter @agent/admin lint
pnpm --filter @agent/admin test
pnpm --filter @agent/admin build
pnpm --filter @agent/web typecheck
pnpm --filter @agent/web build
pnpm --filter @agent/api typecheck
pnpm typecheck
git diff --check
```

确定性检查覆盖：

- 8 条 Demo Run 与汇总结果；
- 关键词、状态、模型、日期筛选；
- 分页、Reset、越界页码收敛与 Store 会话复用；
- 两个 Run Detail Tab 标题可区分；
- `/overview`、`/runs`、`/runs/:runId` 的菜单激活路径；
- Tool Calling durable Step 顺序与 `tool_calls -> stop`；
- running / failed / aborted 的时间和状态一致性；
- Safe Raw Data 不包含禁止字段。

真实 Chrome 验证覆盖：

- `2560 × 1213`、`1440 × 900`、`1280 × 900`；
- 亮色、暗色和 Sidebar 展开 / 折叠；
- 两个可区分的 Run Detail Tab；
- Run Detail 中 `Runs` 持续高亮；
- `5 / page` 第 2 页进入详情后返回仍保留；
- `COMPLETED` 筛选通过 Back、Breadcrumb、Route Tab 和浏览器后退返回后仍保留；
- Reset 恢复 8 条 Demo Run、第一页和 `8 / page`；
- 页面无全局水平溢出，console error / warning 为 0。

截图：

- [亮色 Run List](../assets/admin-console/issue-21-real-chrome-light-run-list.jpg)
- [暗色 Run List](../assets/admin-console/issue-21-real-chrome-dark-run-list.jpg)
- [亮色 Run Detail](../assets/admin-console/issue-21-real-chrome-light-run-detail.jpg)
- [暗色 Run Detail](../assets/admin-console/issue-21-real-chrome-dark-run-detail.jpg)
- [Sidebar 折叠 Run List](../assets/admin-console/issue-21-real-chrome-collapsed-run-list.jpg)
- [暗色双 Run Detail Tabs](../assets/admin-console/issue-21-review-two-run-tabs-dark.jpg)
- [亮色 Run Detail / Sidebar 折叠](../assets/admin-console/issue-21-review-run-detail-light.jpg)

### 验收结论

- 2026-07-20：GPT 结合 Issue #21、PR #22 最新 diff、已解决 Review Thread、自动验证、真实浏览器记录与截图完成复验，结论为通过。
- 用户明确确认验收通过，并授权 GPT 更新任务状态、将 PR #22 转为 Ready 并合并。
- Admin UI 修复基线为 `c9180f6af1f0df4902645ea5debcd07f01784f33`。
- 合并前最新 head 为 `9d548df4c591414e4a50079a977622d31fe070d6`；最后一个提交只增加用户本人确认保留的 LLM stream 代码注释，不改变运行行为，也不作为 Task 1 阻塞项。
- 当前无 GitHub Actions workflow run；验收依据为本地自动验证、真实 Chrome 验证、Review 修复证据和 GPT 代码复核。

### GitHub 交付记录

- Issue：[#21](https://github.com/mufeiyu-ayu/agent/issues/21)
- 分支：`codex/issue-21-admin-run-ui`
- PR：[#22](https://github.com/mufeiyu-ayu/agent/pull/22)
- GPT 验收结论：通过
- 用户确认：已确认验收并授权收口与合并

### 任务状态

- 实施状态：已实现
- 验收状态：已通过

Task 1 已满足 Completed 条件。PR 合并是独立动作，本次已获得用户明确授权。

## 后续规划

- Task 2：基于已经确认的页面信息架构，设计并实现只读 Run / Step 查询 API。
- Task 3：将静态 Run UI 接入真实查询数据，替换 Mock 数据源。
- Task 4：补充后台登录、权限控制和敏感信息脱敏。

开始任一后续 Task 前，仍需创建独立 Issue；不得因 Task 1 完成而自动推进。