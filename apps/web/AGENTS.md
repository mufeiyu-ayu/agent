# apps/web 导图

Vue 3 前台（Vite，端口 5173）。给模型的路径导图：只写入口、分层、核心文件与约束。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts -> src/App.vue -> src/router/index.ts   # / 首页、/privacy（公开）、/login（独立登录页：登录失效、401、Google 回调都落到这里，登录后回 redirect）、/change-password、/workspace；路由守卫按 useAuth 判登录与强制改密码；主动退出回 /
页面（views）负责组合 -> 组件（components）负责渲染 -> hooks 负责状态 / 请求 / 副作用 -> api 负责 HTTP -> utils 只放纯函数
```

## 目录

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `views/` | `HomeView.vue` 首页（组合各部分，放跨部分共用样式；提供登录态与登录弹窗、One Tap）、`ChatWorkspaceView.vue` 对话工作区（组合所有对话 hooks 与组件）、`LoginView.vue`、`ChangePasswordView.vue`、`PrivacyView.vue`（Google 同意屏幕登记的隐私说明） | |
| `hooks/` | 状态与副作用 | `useAuth.ts`（当前用户单例、登录 / 退出 / 改密码）、`useGoogleLogin.ts`（Google 配置、跳转登录的 loading、One Tap：GIS 加载失败静默跳过）、`useChatWorkspace.ts`（会话、发送、NDJSON 流消费、中断）、`useHtmlPreview.ts`（右侧预览的选择、关闭与分栏比例，代码卡片经注入上下文打开）、`useLlmRuntime.ts`（模型下拉、思考强度、余额）、`useStreamingMarkdown.ts`（流式正文平滑放出、按顶层块记忆化、每次提交的新字记成一批渐显）、`useRunStatus.ts`（等待过程的显示时序：1 秒阈值、整秒计时、步骤与思考短句的最短停留与排队）、`useTrailingDot.ts`（尾点跟随正文末尾的测量）、`useComposerAttachments.ts`（待发送附件的添加校验、上传、重试与移除；列表本身归 `useChatWorkspace`）；首页动效：`useHeroTour.ts`（演示窗口时间轴）、`useConnectRouting.ts`（Connect 打字与路由）、`useHomeMotion.ts`（滚动编排与场景入场） |
| `api/` | HTTP | `http.ts`（axios 实例，自动解包 `{ success, data }`；`handleAuthFailure` 把 401 / 需改密码的 403 统一跳页，流式请求共用）、`auth.ts`、`chat.ts`（`POST /api/chat/stream` 流读取）、`conversations.ts`、`llm.ts`、`attachments.ts`（附件上传 / 移除与内容地址） |
| `components/chat/` | `ChatComposer.vue`：空态大输入框 / 对话中单行胶囊两套布局、随内容增高；`ChatModelMenu.vue`：模型与思考强度下拉；`ChatTypewriterPlaceholder.vue`：空态打字机提示；`ChatAttachMenu.vue`：加号弹出的菜单（添加图片或文件，其余是还没有功能的占位入口）；`ChatComposerAttachments.vue`：输入框内待发送附件（同样大小的方块：图片缩略图、文件用 `ChatAttachmentFileThumb.vue` 画的带扩展名角标的小纸片，圆环上传进度与失败重试）。文件选择框、粘贴、整窗拖放都在 `ChatComposer.vue` | |
| `components/agent/` | 对话消息渲染：Markdown、限高代码卡片与独立 HTML 预览、等待过程 | `AgentConversation.vue`、`AgentMarkdownContent.vue`（流式正文渲染入口，块列表来自 `useStreamingMarkdown`；在渐显的块走 `AgentMarkdownFadeBlock.ts`（token → VNode，新字包进淡入片段），其余 v-html）、`AgentCodeBlock.vue`（完整 HTML 的预览与原文下载入口；片段只展示代码）、`HtmlPreviewPanel.vue`（独立预览，无服务端执行）、`AgentRunStatus.vue`（呼吸点、单行状态与摘要，正文作插槽；尾点是浮层，不进 Markdown 的 DOM）、`AgentRunTimeline.vue`（摘要展开后的时间线：工具步骤与每轮思考交错，思考可再展开原文）、`AgentMessageAttachments.vue`（用户消息里的图片与一行一个的文件列表，图片按原始尺寸预留位置）、`AgentAttachmentPreview.vue`（原生 dialog 全屏看图，同一条消息内左右切换）、`AttachmentPreviewPanel.vue`（上传文档在右侧面板里的渲染预览：Markdown、CSV / xlsx 表格、docx、文本、PDF；与 HTML 预览、工作文件面板三者同时只开一个，和沙箱工作区无关） |
| `components/auth/` | 登录卡片（`/login` 与首页弹窗共用：邮箱密码 + Google / Apple 按钮（Apple 暂未接入，点了只提示）+ 待审核提示）与首页登录弹窗 | `LoginForm.vue`、`LoginDialog.vue` |
| `components/common/` | 通用基础设施：图标、语义悬浮提示、全局消息 | `AppIcon.vue`、`AppTooltip.vue`、`AppMessage.vue` |
| `components/layout/` | 壳、头部、侧栏、会话列表、设置弹窗（主题 / 文字亮度 / 语言） | `AppShell.vue`、`SettingsDialog.vue` |
| `components/home/` | 首页「Agent for Teams」各部分：导航、hero 与演示窗口、五个场景、收尾、页脚。按设计稿百分百还原：CSS 照搬原稿、只有英文、始终浅色，不接 i18n 与主题；「Start asking」未登录时弹登录框 | `HomeHeroDemo.vue`、`HomeStartLink.vue`、`home-login.ts`（HomeView 提供的登录态） |
| `components/ui/` | shadcn 风格基础组件 | |
| `utils/` | 纯函数：会话分轮、时间格式、Markdown 分块与高亮、流式尾块补齐、渐显批次与 VNode 路径支持的 token、等待过程的事件归并与刷新后还原（#212）、思考短句与文案、首页缓动 | `conversation-turns.ts`、`markdown-blocks.ts`、`streaming-markdown.ts`、`markdown-fade.ts`（只支持常见行内 token，其余整块回退 v-html）、`run-status.ts`、`attachments.ts`（附件类型与上限、预览方式、图片显示尺寸、按预览上限提前停下的 CSV 解析）、`attachment-documents.ts`（xlsx 线程入口与 docx 离线渲染，悬停 Word 文件时预拉取解析库）、`attachment-sheets.worker.ts`（xlsx 解压、解析与单元格格式化，关闭/切换预览时终止） |
| `public/` | 静态资源 | `html-preview.html`（可信预览外层：CSP 禁网、消息来源校验与隔离 iframe） |
| `types/` | 前台内部类型；跨端协议一律从 `@agent/contracts` 取 | |
| 工作文件 | 只读 Source 文件树、展示格式化与固定版本源码 ZIP；成功多文件 dist 按 Artifact 身份隔离预览，失败保留旧构建；旧 HTML/演示桥接兼容。回答下方的交付卡片从保存记录恢复并打开对应源码 | `hooks/useWorkspaceFiles.ts`、`api/workspace.ts`、`components/agent/WorkspaceFilesPanel.vue`、`components/agent/AgentWorkspaceArtifact.vue`、`public/html-preview.html` |
| `i18n/` | 中英文案，`messages.test.ts` 校验两份键一致 | |

## 约束

- 前端不保存模型平台 API Key；模型只以后台模型行 id 引用。
- UI message ≠ model message ≠ runtime event；流里的 delta 不等于持久化事实，以 `done` 事件与后端记录为准。
- 全局样式让 `button` 继承字体：按钮上的字号 / 行高 / 字重工具类不生效，写在按钮里面的元素上。
- 附件先上传拿到服务端 id，发送时只带 id；这次页面里发出的附件继续用本地 object URL 显示，其余消息的附件来自接口（图片在列表里用缩略图地址）；消息换成服务端快照、会话删除或离开工作区时放掉本地地址。请求发出后没等到 start 就断了（停止、断网），这批附件保持锁定，读一次会话消息确认有没有被绑走，再决定移出输入框还是解锁，不直接当成可重发的草稿。类型一律按扩展名判断，上限与扩展名表取自 `@agent/contracts`。选中的模型不能看图片而附件里有图片时不让发送。
- 上传的文档内容不可信：docx 在离线容器渲染后进入禁脚本、禁网、无 same-origin 权限的 iframe，样式不能进入应用页面；不渲染内嵌 HTML，链接只留 http / https / mailto。xlsx 的解析/格式化在原生 Worker 中，整本在线程里解析，但只格式化并回传预览范围内的行列；CSV 凑够预览行数就停止解析；两种解析库不进首屏。
- 不为了拆而拆，也不让单个 hook / 组件无限膨胀。

## 验证

`pnpm --filter @agent/web typecheck`、`lint`、`test`（Vitest 单测），必要时 `build`；浏览器回归用根目录 `pnpm test:e2e`（Playwright）。测试规范见 `docs/testing.md`。
