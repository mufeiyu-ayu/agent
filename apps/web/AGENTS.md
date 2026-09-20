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
| `views/` | `HomeView.vue` 首页、`ChatWorkspaceView.vue` 对话工作区（组合所有对话 hooks 与组件） | |
| `hooks/` | 状态与副作用 | `useChatWorkspace.ts`（会话、发送、NDJSON 流消费、中断）、`useLlmRuntime.ts`（模型下拉、思考强度、余额） |
| `api/` | HTTP | `http.ts`（axios 实例，自动解包 `{ success, data }`）、`chat.ts`（`POST /api/chat/stream` 流读取）、`conversations.ts`、`llm.ts` |
| `components/chat/` | `ChatComposer.vue`：输入框、模型与思考强度选择 | |
| `components/agent/` | 对话消息渲染：Markdown、引用面板、来源卡片 | `AgentConversation.vue`、`AgentGroundingPanel.vue` |
| `components/layout/` | 壳、头部、侧栏、会话列表 | `AppShell.vue` |
| `components/home/` | 首页动效与流程图，纯展示 | |
| `components/ui/` | shadcn 风格基础组件 | |
| `utils/` | 纯函数：会话分轮、引用投影、时间格式 | `conversation-turns.ts`、`message-grounding.ts` |
| `types/` | 前台内部类型；跨端协议一律从 `@agent/contracts` 取 | |
| `i18n/` | 中英文案，`messages.test.ts` 校验两份键一致 | |

## 约束

- 前端不保存模型平台 API Key；模型只以后台模型行 id 引用。
- UI message ≠ model message ≠ runtime event；流里的 delta 不等于持久化事实，以 `done` 事件与后端记录为准。
- 不为了拆而拆，也不让单个 hook / 组件无限膨胀。

## 验证

`pnpm --filter @agent/web typecheck`、`lint`，必要时 `build`。
