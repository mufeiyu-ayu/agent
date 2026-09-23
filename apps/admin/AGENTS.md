# apps/admin 导图

Vue 3 运维控制台（Vite，端口 5174，ant-design-vue）。给模型的路径导图：只写入口、分层、核心文件与约束。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts -> src/App.vue（主题 token）-> src/router/index.ts -> layouts/AdminLayout.vue
路由：overview / conversations(:id) / runs(:id) / llm-models
views 组合 -> features/<领域>/ 的 state + api + components -> features/shared 的通用请求与列表 / 详情状态基座
```

## 目录

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `views/` | 每个路由一个页面，只做组合 | `RunDetailView.vue`、`LlmModelsView.vue` |
| `features/shared/` | 所有 feature 共用 | `admin-api.ts`（请求层，解包 `{ success, data }`、错误文案）、`paged-list.state.ts`、`detail-fetch.state.ts` |
| `features/runs/` | Run Trace：列表、详情、时间线与 Inspector | `run-detail.state.ts`、`trace/run-trace.presenter.ts`、`trace/RunTraceWorkspace.vue`、`trace/inspectors/` |
| `features/conversations/` | 会话记录 | `conversation-detail.state.ts` |
| `features/overview/` | 概览：健康 / 延迟 / 用量 / 工具，统计与余额两路并行；不读模型目录，模型的可见 / 默认 / 探活只在模型接入页 | `overview.state.ts`（加载与派生）、`overview.model.ts`（纯映射，`overview.model.check.ts` 覆盖）、`components/`（KPI 含余额 / 趋势 / 失败原因（点击下钻运行列表）/ 模型表 / 工具表） |
| `features/llm/` | 模型接入：服务商 / 模型 / 可见性 / 默认 / 推理强度 | `llm-models.state.ts`（状态与动作）、`llm-api.ts`、`components/LlmModelTable.vue`、`components/LlmProviderFormModal.vue` |
| `components/layout/` | 侧栏、路由 tab、主题与语言切换 | `AdminSidebar.vue`（菜单项在这里） |
| `components/common/` | 页面容器、空态、状态徽标 | |
| `lib/` `stores/` | 主题 / 侧栏偏好与路由 tab 的持久化 | `admin-state.ts` |
| `i18n/` | 中英文案，`i18n.check.ts` 校验中英键一致、每个键在 src 里被引用（动态拼接的键登记前缀白名单） | |
| `styles/index.css` | 设计 token（颜色 / 圆角 / 阴影 CSS 变量） | |

## 约束

- 管理台是唯一的写入口（模型配置等），密钥只回显尾四位，表单留空表示不改；编辑服务商改了地址必须重填密钥（后端同样拒绝）。
- 跨端类型从 `@agent/contracts` 取，feature 内只放视图模型与展示映射。
- 一个 feature 内按 state / api / components 拆；只有一个消费者的东西不抽到 shared。

## 验证

`pnpm --filter @agent/admin typecheck`、`lint`、`test`（`*.check.ts` 状态与数据检查，含 i18n 引用检查），必要时 `build`；改 Run Trace / 模型接入页交互时跑 `test:e2e`（Playwright）。
