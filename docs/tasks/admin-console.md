# Admin Console

本文记录 Agent Runtime Console 的长期建设边界和任务状态。当前只启动 Task 0，不提前实施后续 Task。

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
| Task 0 | Active | 初始化 Admin 前端基础壳 | [#19](https://github.com/mufeiyu-ayu/agent/issues/19) | 待创建 | 已实现 | 待验收 |
| Task 1 | Planned | 静态 Run List / Run Detail UI | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 2 | Planned | Admin 只读 Run / Step 查询 API | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 3 | Planned | 后台接入真实运行数据 | 未创建 | 未创建 | 未开始 | 未验收 |
| Task 4 | Planned | 登录、权限、敏感信息脱敏 | 未创建 | 未创建 | 未开始 | 未验收 |

`Active` 只适用于 Task 0。Task 1-4 目前只是顺序规划，不创建实现 Issue，也不提前编码。

## 关键架构决定

1. `apps/admin` 复用当前根 workspace、依赖版本和工程命令，不嵌套 Vben monorepo。
2. Vben 只提供视觉语言和布局参考；业务组件直接使用 Ant Design Vue，不复制完整 `apps/web-antd`，不重建通用组件框架。
3. Task 0 只包含 Sidebar、Header、Breadcrumb、Route Tabs、Page Content、主题、Sidebar 折叠和静态占位路由。
4. 最小偏好状态由 Pinia 管理并写入 `localStorage`；暂不迁移 Vben 的完整 preferences 系统。
5. Overview、Runs 和 404 是静态路由；真实 Run / Step 查询、数据表格和详情页分别留给后续 Task。
6. 登录、权限和敏感信息脱敏必须等真实数据边界明确后独立实施，不与基础壳捆绑。

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
- [ ] Draft PR 包含验证结果、Vben 来源、未覆盖范围和三种要求截图。

### 风险点

| 风险 | 应对 |
| --- | --- |
| 视觉参考演变成完整 Vben 迁移 | 只保留 Task 0 所需布局闭包，并检查依赖与文件范围 |
| 基础壳提前耦合真实 Run 数据 | 页面保持静态，不定义或调用后台查询 API |
| 主题 token 与自定义样式不一致 | 统一由最小偏好状态驱动 Ant Design Vue token 和 CSS Variables |
| Task 0 被误认为阶段 8 已完成 | 看板和路线图明确标注其仅为可观测性 UI 基础设施 |

### GitHub 交付记录

- Issue：[#19](https://github.com/mufeiyu-ayu/agent/issues/19)
- 分支：`feat/admin-console-foundation`
- PR：待创建（必须保持 Draft）
- GPT 验收结论：未提供
- 用户确认：未确认

### 任务状态

- 实施状态：已实现
- 验收状态：待验收

当前只记录“已实现、待验收”；不得自行标记 Completed、归档或合并。
