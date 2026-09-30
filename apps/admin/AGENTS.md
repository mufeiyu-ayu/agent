# apps/admin 导图

Vue 3 运维控制台（Vite，端口 5174，ant-design-vue）。给模型的路径导图：只写入口、分层、核心文件与约束。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts -> src/App.vue（主题 token）-> src/router/index.ts -> layouts/AdminLayout.vue
路由：overview / conversations(:id) / runs(:id) / llm-models / runtime-config / users；login、change-password、forbidden 在布局外；守卫要求登录且为管理员，成员进 forbidden
views 组合 -> features/<领域>/ 的 state + api + components -> features/shared 的通用请求与列表 / 详情状态基座
```

## 目录

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `views/` | 每个路由一个页面，只做组合 | `RunDetailView.vue`、`LlmModelsView.vue` |
| `features/shared/` | 所有 feature 共用 | `admin-api.ts`（请求层，解包 `{ success, data }`、错误文案、401 / 需改密码的 403 统一跳页）、`paged-list.state.ts`、`detail-fetch.state.ts` |
| `features/runs/` | Run Trace：列表、详情、时间线与 Inspector | `run-detail.state.ts`、`trace/run-trace.presenter.ts`、`trace/RunTraceWorkspace.vue`、`trace/inspectors/` |
| `features/conversations/` | 会话记录：按用户与最近活跃时间筛选，筛选条件只存在地址栏（用户列表「查看对话」带 `userId` 跳入） | `conversation-api.ts`、`conversation-detail.state.ts` |
| `features/overview/` | 概览：健康 / 延迟 / 用量 / 工具，统计与余额两路并行；不读模型目录，模型的可见 / 默认 / 探活只在模型接入页 | `overview.state.ts`（加载与派生）、`overview.model.ts`（纯映射，`overview.model.test.ts` 覆盖）、`components/`（KPI 含余额 / 趋势 / 失败原因（点击下钻运行列表）/ 模型表 / 工具表） |
| `features/llm/` | 模型接入：服务商 / 模型 / 可见性 / 默认 / 推理强度 / 单次输入上限（token 数一律千分位） | `llm-models.state.ts`（状态与动作）、`llm-api.ts`、`components/LlmModelTable.vue`、`components/LlmProviderFormModal.vue` |
| `features/runtime-config/` | 系统管理 → 运行配置：单次最长时间、Serper Key、调试开关，整页一个保存（时限按秒编辑、按毫秒提交） | `runtime-config.state.ts`（加载、保存与表单映射）、`runtime-config-api.ts` |
| `features/auth/` | 当前用户单例、登录 / 退出 / 改密码、回跳地址校验、Google 重定向登录（管理台不做 One Tap） | `auth.state.ts`、`auth-api.ts` |
| `features/users/` | 系统管理 → 用户列表：建号、按状态筛选、审核待审核账号（通过 / 拒绝）、停用、重置密码、改角色 | `users.state.ts`、`users-api.ts` |
| `components/layout/` | 侧栏（分组 → 菜单项）、面板顶栏里的收起按钮、路由 tab、主题切换、账号菜单（退出） | `AdminSidebar.vue`（菜单项在这里） |
| `components/common/` | 页面容器与页头、列表表格（表头吸顶、分页贴底、整行跳转，列表页统一用它）、空态、用户头像（图片加载失败回退首字母）与头像 + 名字 + 邮箱 | `DataTable.vue`、`UserAvatar.vue`、`UserIdentity.vue` |
| `lib/` `stores/` | 主题 / 侧栏偏好与路由 tab 的持久化 | `admin-state.ts` |
| `i18n/` | 文案字典，只有中文（不做多语言），页面经 `t()` 取用 | |
| `styles/index.css` | 设计 token（颜色 / 圆角 / 阴影 CSS 变量） | |

## 约束

- 管理台是唯一的写入口（模型配置等），密钥只回显尾四位，表单留空表示不改；编辑服务商改了地址必须重填密钥（后端同样拒绝）。
- 跨端类型从 `@agent/contracts` 取，feature 内只放视图模型与展示映射。
- 一个 feature 内按 state / api / components 拆；只有一个消费者的东西不抽到 shared。

## 验证

`pnpm --filter @agent/admin typecheck`、`lint`、`test`（Vitest 单测：状态、数据映射与 i18n），必要时 `build`；改 Run Trace / 模型接入页交互时跑根目录 `pnpm test:e2e`（Playwright）。测试规范见 `docs/testing.md`。
