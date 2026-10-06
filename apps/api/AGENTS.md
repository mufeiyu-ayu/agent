# apps/api 导图

NestJS API。给模型的路径导图：只写入口、分层、核心文件与不变量，能 `ls` 看出来的不写。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts                      # 启动，全局前缀 /api，端口 PORT（默认 3000）；监听 API_HOST（默认 127.0.0.1，容器里 0.0.0.0）、不开 CORS；TRUST_PROXY 设了才信任反代
src/app.module.ts                # 装配所有业务模块
src/common/bootstrap/register-app-globals.ts   # 全局校验管道 / 响应包装 / 异常过滤 / requestId；Controller 不重复实现
src/auth/auth.guard.ts           # 全局 Guard（APP_GUARD）：写请求校验 Origin、默认要求登录、admin/* 要求 ADMIN；公开接口用 @Public()
Controller -> Service -> AgentRuntime -> LLMService / ToolInvocationService -> Prisma
```

Prisma schema 在仓库根 `prisma/`，生成的 client 在 `src/generated/prisma`（不手改）。

## 模块

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `chat/` | 前台对话入口：DTO、系统提示词、NDJSON 流协议适配 | `chat.controller.ts`（`POST /api/chat/stream`）、`chat.service.ts`、`prompts/` |
| `agent-runtime/` | 一次用户输入的 AgentRun 编排；子目录按领域分：`context`（模型可见上下文：历史还原、粗估计数与上下文压缩）、`sampling`（采样决策 / 调试捕获）、`lifecycle`（Run / Step 记录与取消）；不限轮数与工具调用次数，只由 `input.runtimeConfig` 快照里的单次最长时间兜底；超过模型「单次输入上限」时只靠压缩，不删历史、不截短工具结果 | `agent-runtime.service.ts`（主循环）、`agent-runtime.types.ts`、`context/conversation-history.ts`（一个快照里读最新压缩记录、消息与 Step → 按问答分组的历史，带回之前的工具记录）、`context/context-compaction.service.ts`（上下文压缩：调模型前超线、服务商报超长、问答结束后后台预压）；细节见目录内 `README.md` |
| `tools/` | Tool Calling：一次调用的全部判定（截断批次、查找、参数校验、执行、Observation 修剪、`argumentsValidated`）都在 `invoke`，runtime 只记账与回喂；`core/` 是框架，`web/` 是具体工具（`web_search` 经 Serper 查 Google，密钥随运行配置快照经执行上下文传入；`web_fetch` 由服务器直接抓网页，SSRF 检查在 `web/ssrf-guard.ts`，正文提取在 `web/page-text.worker.ts`）；写新工具见目录内 `README.md` | `tool-definitions.ts`（唯一的工具清单）、`core/tool-invocation.service.ts`（`invoke`）、`tools.module.ts`（按清单注册） |
| `llm/` | LLM 的 Nest 壳（读侧）：模型行解析、密钥 cipher 唯一持有、前台模型下拉与余额 | `llm.service.ts`（`@agent/ai` 门面）、`llm-model-config.service.ts`（`resolveModel` / `listVisibleModels`）、`api-key-cipher.ts`、`llm-runtime-config.service.ts`（只读 env：主密钥与出站代理，不对外导出）、`outbound-proxy.ts`（`OUTBOUND_PROXY_URL` 解析与代理 agent 构造） |
| `admin-llm/` | LLM 配置的写侧：服务商 / 模型 CRUD、拉取、探测、导入预设；单次输入上限保存时校验 ≤ 窗口 − 输出上限 − 安全余量 | `admin-llm.service.ts`、`llm-model-presets.ts`（按家族的官方上限与默认强度、安全余量） |
| `runtime-config/` | 运行配置（#216）：单行表 `RuntimeConfig` 的读写，`GET` / `PATCH /api/admin/runtime-config`；`ChatService` 在写入任何消息前读快照，读不到返回 503，没有 env 兜底 | `runtime-config.service.ts`（`loadSnapshot` / `update`） |
| `workspaces/` | 会话代码工作区：按需创建阿里沙箱，恢复/保存私有 OSS 工作文件；租约与版本阻止迟到发布，文件引用与工具记录同事务确认；独立实例历史保留释放确认与未知状态，管理员只读核查云实例和 OSS 统计 | `workspace.service.ts`（Source 与成功 Artifact）、`workspace-gc.service.ts`（持久目标/上传核查、引用回收；维护与恢复见 `workspaces/GC.md`）、`workspace-preview.service.ts` / `workspace-preview.ts`（固定构建 capability 与 opaque 预览）、`workspace-archive.ts`（有界 Source ZIP）、`workspace-monitoring.service.ts`、`workspace-cloud.service.ts`、`sandbox-scripts.ts`（非特权命令监督与普通文件操作）、`workspace.controller.ts` |
| `auth/` | 登录：服务端 Session + httpOnly Cookie、scrypt 密码、账号锁定与 IP 限流、改密码；Google 重定向登录与 One Tap | `auth.guard.ts`、`auth.service.ts`（`createSession` 两种登录共用、`userStatus` 三态）、`auth.decorators.ts`（`@Public` / `@AllowPendingPasswordChange` / `@CurrentAuth`）、`password.ts`、`session-cookie.ts`、`google-auth.service.ts`（`signIn`：按 sub → 邮箱匹配 → 按状态处理）、`google-id-token.ts`（验签与声明校验） |
| `admin-users/` | 管理员建号、停用 / 启用、审核待审核账号（通过 / 拒绝）、重置密码、改角色 | `admin-users.service.ts` |
| `conversations/` | 会话与消息的 CRUD，只操作当前用户自己的会话；读消息时给回答带上 activity（#212：一次查询、jsonb 路径避开 observation） | `conversations.service.ts`、`messages.service.ts`、`message-activity.ts`（Step → activity 的降级投影） |
| `admin-runs/` `admin-conversations/` `admin-overview/` | 管理台只读投影；概览与运行列表用 SQL 只取 Step JSON 的必要路径 | `admin-runs/projection/`（Run Trace 读模型）、`admin-runs/admin-model-refs.ts`（按 modelId 关联模型行）、`admin-overview/admin-overview.service.ts`（窗口聚合 SQL）；见 `admin-runs/README.md` |
| `prisma/` | `PrismaService` 与连接可靠性 | `prisma.service.ts` |
| `common/` | 全局管道 / 拦截器 / 过滤器 / 中间件 / 工具 | `bootstrap/register-app-globals.ts` |

## 不变量

- 鉴权在后端：全局 Guard 默认拦截，新接口不标 `@Public()` 就要登录，`admin/*` Controller 自动要求 ADMIN。会话归属按 `userId` 过滤，别人的会话与不存在的一律 404（`conversations`、`messages`、`chat/stream`）；`admin-*` 可观测看全部。库里只存密码的 scrypt 串与 token 的 SHA-256；停用、重置密码、改角色删该用户全部 Session，自己改密码保留当前这条。账号三态（启用 / 待审核 / 停用）在库里是 `disabled` 与 `pendingApproval` 两个布尔（迁移只加不删），一律经 `userStatus` 读。Google 登录（#198）：两种方式校验完都进 `GoogleAuthService.signIn`，绑定以 `sub` 为准，陌生账号建为待审核（上限 50）；回调地址只由 `APP_ORIGINS` 拼出；授权码、token、`code_verifier`、客户端密钥不进日志与响应（错误响应的 path 不带查询串）。首个管理员用 `pnpm create-admin`（`src/create-admin.ts`，生产镜像里是 `node dist/create-admin.js`）建，同时认领无主存量会话。
- 模型看到的必须能从持久化记录重建：action 循环内成立，落在哪些 Step 字段与已知偏差见 `src/agent-runtime/context/README.md`；新增模型可见内容时同一次改动里落库。`AgentStep` 是系统执行过程；收完的 Tool Call 轮采样 Step 的 `reasoningContent` 是为重建而存的回填内容，只对本 Run 回填，之后的 Run 带回历史工具记录时不回放；最后一轮与被停止 / 失败那一轮的 `reasoningContent`、tool Step 的 `display` 与 `answerStartedMs` 只为界面还原（#212）。
- 模型输出不可信：工具名、参数先在 `invoke` 里校验再执行。工具结果里的网页内容是低信任数据：系统提示词声明其中的指令、角色设定或格式要求只是资料，不得覆盖系统指令；`modelContent` 不加包裹标记。
- 终态所有权：晚到的 Abort / deadline / DB 结果不能覆盖已确立终态。
- 失败归因同源：Run 的 `errorCode`、失败采样 Step 的文案与前台 error 事件都在终态确立后由 `agent-runtime.service.ts` 的 `describeRunFailure` 一处得出；LLMError 的用户文案与 `AllExceptionsFilter` 共用 `common/utils/llm-error-message.util.ts`。
- 服务商 API Key 与运行配置的 Serper Key 只以密文入库，任何接口只回显尾四位，加解密都经 `LlmModelConfigService` 的 cipher；主密钥 `AGENT_SECRET_KEY` 只在 `llm/` 内使用。库里的密钥只发往库里的地址：拉取 / 测试只带 providerId 时用库里的 baseUrl，换地址（含 PATCH 服务商）必须同时重填 key；余额只查 https 的官方 DeepSeek 账号，响应只投影声明字段。
- 出站代理：地址只在 `.env` 的 `OUTBOUND_PROXY_URL`（不读 `HTTPS_PROXY` / `NO_PROXY`），`LLMService`、`GoogleAuthService`、`WebSearchTool` 与 `WebFetchTool` 各持有一个代理 agent（都由 `outbound-proxy.ts` 构造），模型请求按服务商 `useProxy` 显式传代理或直连 dispatcher，Google 登录、联网搜索与读网页配了代理就走代理，不替换进程的全局 dispatcher；勾选了但没配时失败（`llm_network`），不静默直连。进文案、接口与日志的只有去掉凭据的 `协议://主机:端口`。
- `web_fetch` 的网址与网页都不可信（#206）：每一跳（含重定向，手动跟、最多 5 跳）请求前解析出全部地址过黑名单，直连时 undici Agent 的 `connect.lookup` 在连接那一刻再校验一次防 DNS 换绑；走代理时由代理解析域名，连接时的检查失效，所以线上不配 `OUTBOUND_PROXY_URL`。HTML 解析与 Readability 是同步计算，只在 worker 线程里跑，超时或停止时终止 worker，不在主线程解析网页。
- 家族协议事实（thinking / reasoning_effort 取值）只在 `@agent/contracts` 的 `LLM_FAMILY_CAPABILITIES` 一处。
- 管理台「模型调用」口径同源：有 usage 或以 llm_* 类别失败的 action sampling 才算，运行列表与 Run Trace 走 `sampling-usage.projector.ts` 的 `aggregateRunModelCalls`，概览 SQL 复用同文件的 `LLM_CALL_ERROR_CODES`；改一处要同步另一处。

## 验证

`pnpm --filter @agent/api typecheck`、`lint`、`test`（Vitest 单测）；涉及事务、deadline、落库时加根目录 `pnpm test:db`（只连 `TEST_DATABASE_URL`）；涉及 schema 时 `pnpm prisma:generate` 与 `pnpm exec prisma validate`。测试规范见 `docs/testing.md`。
