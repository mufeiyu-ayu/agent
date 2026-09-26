# apps/web 导图

Vue 3 前台（Vite，端口 5173）。给模型的路径导图：只写入口、分层、核心文件与约束。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts -> src/App.vue -> src/router/index.ts   # 两个页面：/ 首页、/workspace 对话工作区
页面（views）负责组合 -> 组件（components）负责渲染 -> hooks 负责状态 / 请求 / 副作用 -> api 负责 HTTP -> utils 只放纯函数
```

## 目录

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `views/` | `HomeView.vue` 首页（组合各部分，放跨部分共用样式）、`ChatWorkspaceView.vue` 对话工作区（组合所有对话 hooks 与组件） | |
| `hooks/` | 状态与副作用 | `useChatWorkspace.ts`（会话、发送、NDJSON 流消费、中断）、`useLlmRuntime.ts`（模型下拉、思考强度、余额）、`useStreamingMarkdown.ts`（流式正文按帧平滑放出、按顶层块记忆化）；首页动效：`useHeroTour.ts`（演示窗口时间轴）、`useConnectRouting.ts`（Connect 打字与路由）、`useHomeMotion.ts`（滚动编排与场景入场） |
| `api/` | HTTP | `http.ts`（axios 实例，自动解包 `{ success, data }`）、`chat.ts`（`POST /api/chat/stream` 流读取）、`conversations.ts`、`llm.ts` |
| `components/chat/` | `ChatComposer.vue`：空态大输入框 / 对话中单行胶囊两套布局、随内容增高；`ChatModelMenu.vue`：模型与思考强度下拉；`ChatTypewriterPlaceholder.vue`：空态打字机提示 | |
| `components/agent/` | 对话消息渲染：Markdown、限高代码卡片（无执行 / 预览能力） | `AgentConversation.vue`、`AgentMarkdownContent.vue`（流式正文渲染入口，块列表来自 `useStreamingMarkdown`）、`AgentCodeBlock.vue` |
| `components/common/` | 通用基础设施：图标、语义悬浮提示、全局消息 | `AppIcon.vue`、`AppTooltip.vue`、`AppMessage.vue` |
| `components/layout/` | 壳、头部、侧栏、会话列表、设置弹窗（主题 / 文字亮度 / 语言） | `AppShell.vue`、`SettingsDialog.vue` |
| `components/home/` | 首页「Agent for Teams」各部分：导航、hero 与演示窗口、五个场景、收尾、页脚。按设计稿百分百还原：CSS 照搬原稿、只有英文、始终浅色，不接 i18n 与主题 | `HomeHeroDemo.vue` |
| `components/ui/` | shadcn 风格基础组件 | |
| `utils/` | 纯函数：会话分轮、时间格式、Markdown 分块与高亮、流式尾块补齐、首页缓动 | `conversation-turns.ts`、`markdown-blocks.ts`、`streaming-markdown.ts` |
| `types/` | 前台内部类型；跨端协议一律从 `@agent/contracts` 取 | |
| `i18n/` | 中英文案，`messages.test.ts` 校验两份键一致 | |

## 约束

- 前端不保存模型平台 API Key；模型只以后台模型行 id 引用。
- UI message ≠ model message ≠ runtime event；流里的 delta 不等于持久化事实，以 `done` 事件与后端记录为准。
- 不为了拆而拆，也不让单个 hook / 组件无限膨胀。

## 验证

`pnpm --filter @agent/web typecheck`、`lint`、`test`（Vitest 单测），必要时 `build`；浏览器回归用根目录 `pnpm test:e2e`（Playwright）。测试规范见 `docs/testing.md`。
