# Admin Console

本文记录 Agent Runtime Console 的长期建设边界和任务状态。Task 0 已完成并通过验收；Task 1 已实现、待验收；Task 2-4 保持 Planned。

## 目标与产品边界

Admin Console 面向项目开发、调试和运行过程复盘，后续用于查看 `AgentRun`、`AgentStep`、模型 sampling、Tool Call、Tool Execution、Observation、Message 与受控错误信息。

Task 0 只建立可独立运行的后台前端基础壳。它是阶段 8“可观测性与作品集”的 UI 基础设施，不代表 Run / Step 查询能力已经完成，也不改变阶段 6、阶段 7、阶段 8 的既有状态。

## 技术基线

- 应用边界：当前 monorepo 内的独立应用 `apps/admin`，包名为 `@agent/admin`。
- 前端基线：Vue 3、Vite、TypeScript、Vue Router、Pinia、Ant Design Vue。
- 视觉基线：只读参考 Vue Vben Admin 5 的 `apps/web-antd`，提取本任务所需的最小视觉和布局能力。
- 依赖边界：不引入 `@vben/*` 或 `@vben-core/*` 运行时依赖，不建立嵌套 workspace 或 lockfile。
- 上游许可：Vben 使用 MIT License；来源、版本与实际改编范围记录在 `apps/admin/THIRD_PARTY_NOTICES.md`。

本次本地参考源码状态：

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
| Task 0 | Completed | 初始化 Admin 前端基础壳 | [#19](https://github.com/mufeiyu-ayu/agent/issues/19) | [PR #20](https://github.com/mufeiyu-ayu/agent/pull/20)（已合并） | 已实现 | 已通过 |
| Task 1 | Active | 静态 Run List / Run Detail UI | [#21](https://github.com/mufeiyu-ayu/agent/issues/21) | [PR #22](https://github.com/mufeiyu-ayu/agent/pull/22)（Draft） | 已实现 | 待验收 |
| Task 2 | Planned | Admin 只读 Run / Step 查询 API | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 3 | Planned | 后台接入真实运行数据 | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 未创建 | 未创建 | 未开始 | 未验收 |

当前 Active 任务为 Task 1：实现已完成，正等待 GPT 学习验收和用户确认。Task 2-4 仍只是顺序规划，本次未启动。

## 关键架构决定

1. `apps/admin` 复用当前根 workspace、依赖版本和工程命令，不嵌套 Vben monorepo。
2. Vben 只提供视觉语言和布局参考；业务组件直接使用 Ant Design Vue，不复制完整 `apps/web-antd`，不重建通用组件框架。
3. Task 0 只包含 Sidebar、Header、Breadcrumb、Route Tabs、Page Content、主题、Sidebar 折叠和静态占位路由。
4. 最小偏好状态由 Pinia 管理并写入 `localStorage`；暂不迁移 Vben 的完整 preferences 系统。
5. Task 1 在 Runs 路由内提供静态 Run List / Run Detail，只依赖前端类型化 Mock 和纯函数，不请求 API。
6. 真实 Run / Step 查询留给 Task 2-3；登录、权限和敏感信息脱敏留给 Task 4，不与静态 UI 捆绑。

## Task 0：初始化 Admin 前端基础壳

### 目标

创建可独立启动、检查和构建的 `@agent/admin`，用最小组件形成稳定的 Vben Ant Design 风格后台壳，为后续可观测性页面提供 UI 容器。

### 学习重点

- 理解独立 workspace app 与嵌套 monorepo 的边界。
- 理解“参考 Vben 视觉”与“引入 Vben 运行时”的区别。
- 理解 Ant Design Vue token、CSS Variables、Pinia 偏好状态和 Router 布局如何协作。
- 理解 MIT 上游源码的来源记录和最小改编原则。

### 范围

- 新建 `apps/admin` 并接入当前根 workspace。
- 实现 Sidebar、Header、Breadcrumb、Route Tabs 和 Page Content。
- 实现 `light`、`dark`、`system` 主题与 Sidebar 折叠状态持久化。
- 提供 Overview、Runs 静态占位页和 404 页面。
- 增加根目录 Admin 开发、构建命令和第三方许可说明。
- 保证现有 Web、API 和 workspace 验证不回退。

### 不做什么

- 不实现真实 Run List、Run Detail、Timeline 或 JSON Viewer。
- 不新增后台查询 API，不修改数据库、Prisma、Agent Runtime 或 Tool Calling。
- 不实现登录、鉴权、RBAC、动态菜单、按钮权限或敏感信息脱敏。
- 不迁移完整 Vben preferences、国际化、通知、锁屏、水印或演示业务页面。
- 不推进 Task 1-4，不改变阶段 6、阶段 7、阶段 8 的既有状态。

### Red：先定义当前缺口

- [x] 当前仓库没有可独立启动的 `@agent/admin`。
- [x] 当前没有 Admin 独立 typecheck、lint、build 命令。
- [x] 当前没有轻量主题、Sidebar 折叠和 Route Tabs 状态边界。
- [x] 当前没有后台建设进度文档和上游许可记录。

### Green：最小实现

- [x] 创建 `@agent/admin` 并接入 Vue Router、Pinia、Ant Design Vue 和必要样式。
- [x] 建立最小后台 Layout 和静态菜单。
- [x] 实现主题、Sidebar 折叠持久化和最小 Route Tabs。
- [x] 创建 Overview、Runs、404 静态页面。
- [x] 增加根目录 Admin scripts。
- [x] 同步任务入口、路线图和 Vben 来源记录。

### Refactor：整理边界

- [x] 确认没有复制当前 Task 不需要的 Vben 演示代码、资产或依赖。
- [x] 确认不存在 `@vben/*`、`@vben-core/*` import、嵌套 workspace 或 lockfile。
- [x] 保持 layout、token、preferences 和页面职责清晰，不为后续 Task 预建框架。

### 验证命令

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

手工验证使用 `pnpm dev:admin`，覆盖根路径重定向、Overview / Runs / 404、Breadcrumb、菜单高亮、Route Tabs、主题切换、Sidebar 折叠、偏好持久化和控制台错误；交付截图覆盖亮色、暗色和 Sidebar 折叠状态。

实施验证结果（2026-07-19）：

- 上述 Admin、Web、API 和 workspace 命令均通过；Admin 状态自检通过。
- `pnpm dev:admin` 在 1440 × 900 视口完成手工验证，控制台无 error / warning。
- 已验证主题与 Sidebar 折叠状态刷新后保留，关闭当前 Runs Tab 后返回 Overview。
- 截图：[亮色 Overview](../assets/admin-console/issue-19-light-overview.jpg)、[暗色 Runs](../assets/admin-console/issue-19-dark-runs.jpg)、[Sidebar 折叠](../assets/admin-console/issue-19-collapsed-runs.jpg)。

### 验收标准

- [x] `@agent/admin` 可独立 dev、typecheck、lint、build。
- [x] Sidebar、Header、Breadcrumb、Route Tabs、Page Content 和静态路由工作正常。
- [x] 明暗主题与 Sidebar 折叠状态可持久化。
- [x] 不存在禁止的 Vben 运行时依赖、嵌套 workspace、lockfile 或超范围功能。
- [x] `THIRD_PARTY_NOTICES.md` 完整记录 Vben 来源和实际改编范围。
- [x] 现有 Web、API 和 workspace 验证无回退。
- [x] PR 包含验证结果、Vben 来源、未覆盖范围和三种要求截图。

### 验收结论

- 2026-07-19：GPT 结合 Issue #19、PR diff、Codex Review、验证结果与截图完成验收，结论为通过。
- Codex Review 对已审核实现未发现重大问题。
- 用户明确确认验收通过，并授权 GPT 完成任务收口、将 PR 转为 Ready 并合并。
- 合并前再次核对最新实现 commit `c5a1f6994ccdddef0abcf8944ed1ae3900bdb79b`；相较已验收版本仅新增 Header Sidebar 展开/折叠入口并更新截图，不改变任务范围或运行数据边界。
- PR #20 已于 2026-07-19 合并到 `master`，merge commit 为 `09ab8344b772783d6c502d8502cff5a29276517b`；Issue #19 已自动关闭。

### 风险点

| 风险 | 应对 |
| --- | --- |
| 视觉参考演变成完整 Vben 迁移 | 只保留 Task 0 所需布局闭包，并检查依赖与文件范围 |
| 基础壳提前耦合真实 Run 数据 | 页面保持静态，不定义或调用后台查询 API |
| 主题 token 与自定义样式不一致 | 统一由最小偏好状态驱动 Ant Design Vue token 和 CSS Variables |
| Task 0 被误认为阶段 8 已完成 | 看板和路线图明确标注其仅为可观测性 UI 基础设施 |

### GitHub 交付记录

- Issue：[#19](https://github.com/mufeiyu-ayu/agent/issues/19)（已关闭）
- 分支：`feat/admin-console-foundation`
- PR：[PR #20](https://github.com/mufeiyu-ayu/agent/pull/20)（已合并）
- Merge commit：`09ab8344b772783d6c502d8502cff5a29276517b`
- GPT 验收结论：通过
- 用户确认：已确认验收并授权合并

### 任务状态

- 实施状态：已实现
- 验收状态：已通过

Task 0 已 Completed 并进入 `master`。

## Task 1：静态 Run List / Run Detail UI

### 目标与边界

基于 Issue #21 中的视觉参考，将 Runs 占位页升级为可独立演示的 Run List 和 Run Detail，用确定性 Mock 表达 AgentRun、durable AgentStep、sampling、Tool Execution 和用户可见 Message 语义。

- 范围：概览指标、本地筛选、表格、分页、状态标记、详情概览、Trace、Messages、Safe Raw Data 和类型化 Mock。
- 数据边界：只使用 `apps/admin` 前端本地数据；派生 Run 生命周期节点，不把它们写成 durable AgentStep。
- 安全边界：Safe Raw Data 只展示 allowlist 投影，不包含完整 prompt、Tool arguments / result、Observation、stack、secret 或 chain-of-thought。
- 不做：不新增 API，不修改 contracts、Prisma、数据库或 Agent Runtime，不推进 Task 2。

### 实施结果

- [x] Run List 展示 4 个概览指标、本地筛选、8 条 Demo Run、状态 Tag 和可切换分页。
- [x] Run Detail 展示概览、durable / derived Timeline、事件详情、用户可见 Messages 和 Safe Raw Data。
- [x] Mock 覆盖 ordinary success、tool success、running、failed 和 aborted；Tool 路径保持 sampling → tool execution → sampling 顺序。
- [x] `RUNNING` 的未知 endedAt / duration / usage 保持 `null`，终态 duration 与 startedAt / endedAt 一致。
- [x] 宽布局按真实 Chrome 视口流式占满主栏，列表表格卡片和分页在剩余高度内贴底展示。

### 验证记录

2026-07-20 完成以下自动验证，全部通过：

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

真实 Chrome 手工验收使用 `2560 × 1157` CSS 视口、DPR 2，未使用固定 viewport override：

- Run List 和 Run Detail 均无页面级水平溢出，展开 Sidebar 时主内容宽 `2296px`，列表表格和 footer 底部距视口 `20px`。
- 已验证明暗主题、Sidebar 展开 / 折叠、筛选 / 重置、分页、列表到详情导航、Trace 事件切换、Messages、Safe Raw Data 复制以及 running / failed / aborted 展示。
- 筛选实操结果：`Status=COMPLETED` 得 5 条，`Model=gpt-4o` 得 2 条，`2026-07-16` 同日 Date Range 得 1 条；每次 Reset 均恢复 8 条。
- 补充响应式回归覆盖 `1440 × 900` 与 `1280 × 900`：两档都无页面级水平溢出或 console error / warning；`1280px` 下仅表格内部水平滚动 `48px`，Trace 仍保持可交互双栏。
- 截图：[亮色 Run List](../assets/admin-console/issue-21-real-chrome-light-run-list.jpg)、[暗色 Run List](../assets/admin-console/issue-21-real-chrome-dark-run-list.jpg)、[亮色 Run Detail](../assets/admin-console/issue-21-real-chrome-light-run-detail.jpg)、[暗色 Run Detail](../assets/admin-console/issue-21-real-chrome-dark-run-detail.jpg)、[Sidebar 折叠](../assets/admin-console/issue-21-real-chrome-collapsed-run-list.jpg)。

### GitHub 交付记录

- Issue：[#21](https://github.com/mufeiyu-ayu/agent/issues/21)
- 分支：`codex/issue-21-admin-run-ui`
- PR：[#22](https://github.com/mufeiyu-ayu/agent/pull/22)（Draft）
- Review：通过 PR 评论 `@codex review` 请求 Codex Review，并保持 Draft
- 限制：按 Issue #21 明确要求保持 Draft，不自行转 Ready、标记 Completed、合并或推进 Task 2。

### 任务状态

- 实施状态：已实现
- 验收状态：待验收

Task 1 保持 Active，等待 GPT 学习验收和用户明确确认；Task 2-4 保持 Planned。
