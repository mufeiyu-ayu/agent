# apps/api 导图

NestJS API。给模型的路径导图：只写入口、分层、核心文件与不变量，能 `ls` 看出来的不写。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts                      # 启动，全局前缀 /api，端口 PORT（默认 3000）；只监听 127.0.0.1、不开 CORS，局域网访问走 Vite 代理
src/app.module.ts                # 装配所有业务模块
src/common/bootstrap/register-app-globals.ts   # 全局校验管道 / 响应包装 / 异常过滤 / requestId；Controller 不重复实现
Controller -> Service -> AgentRuntime -> LLMService / ToolRegistry -> Prisma
```

Prisma schema 在仓库根 `prisma/`，生成的 client 在 `src/generated/prisma`（不手改）。

## 模块

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `chat/` | 前台对话入口：DTO、系统提示词、NDJSON 流协议适配 | `chat.controller.ts`（`POST /api/chat/stream`）、`chat.service.ts`、`prompts/` |
| `agent-runtime/` | 一次用户输入的 AgentRun 编排；子目录按领域分：`context`（模型可见上下文）、`sampling`（采样决策 / 调试捕获）、`lifecycle`（Run / Step 记录与取消）、`configuration`（运行策略） | `agent-runtime.service.ts`（主循环）、`agent-runtime.types.ts`；细节见目录内 `README.md` |
| `tools/` | Tool Calling：注册、参数校验、执行、Observation 预算；`articles/` 是具体工具（只有 `search_articles`，查询在工具文件内） | `tool-definitions.ts`（工具清单）、`core/tool-registry.service.ts`、`core/tool-invocation.service.ts` |
| `llm/` | LLM 的 Nest 壳（读侧）：模型行解析、密钥 cipher 唯一持有、前台模型下拉与余额 | `llm.service.ts`（`@agent/ai` 门面）、`llm-model-config.service.ts`（`resolveModel` / `listVisibleModels`）、`api-key-cipher.ts`、`llm-runtime-config.service.ts`（只读 env，不对外导出）、`outbound-proxy.ts`（`OUTBOUND_PROXY_URL` 解析与代理 agent 构造） |
| `admin-llm/` | LLM 配置的写侧：服务商 / 模型 CRUD、拉取、探测、导入预设 | `admin-llm.service.ts`、`llm-model-presets.ts`（按家族的官方上限与默认强度） |
| `conversations/` | 会话与消息的 CRUD | `conversations.service.ts`、`messages.service.ts` |
| `admin-runs/` `admin-conversations/` `admin-overview/` | 管理台只读投影；概览与运行列表用 SQL 只取 Step JSON 的必要路径 | `admin-runs/projection/`（Run Trace 读模型）、`admin-runs/admin-model-refs.ts`（按 modelId 关联模型行）、`admin-overview/admin-overview.service.ts`（窗口聚合 SQL）；见 `admin-runs/README.md` |
| `prisma/` | `PrismaService` 与连接可靠性 | `prisma.service.ts` |
| `common/` | 全局管道 / 拦截器 / 过滤器 / 中间件 / 工具 | `bootstrap/register-app-globals.ts` |

## 不变量

- 模型看到的必须能从持久化记录重建：action 循环内成立，落在哪些 Step 字段与范围外的部分见根 `AGENTS.md` 第 6 节；新增模型可见内容时同一次改动里落库。`AgentStep` 是系统执行过程，采样 Step 的 `reasoningContent` 只是为重建而存的回填内容。
- 模型输出不可信：工具名、参数先校验再执行；检索正文按 untrusted data 注入（已知缺口：`search_articles` 的文章摘录以纯 JSON 回喂，没有隔离标记）。
- 终态所有权：晚到的 Abort / deadline / DB 结果不能覆盖已确立终态。
- 失败归因同源：Run 的 `errorCode`、失败采样 Step 的文案与前台 error 事件都在终态确立后由 `agent-runtime.service.ts` 的 `describeRunFailure` 一处得出；LLMError 的用户文案与 `AllExceptionsFilter` 共用 `common/utils/llm-error-message.util.ts`。
- 服务商 API Key 只以密文入库，任何接口只回显尾四位；主密钥 `AGENT_SECRET_KEY` 只在 `llm/` 内使用。库里的密钥只发往库里的地址：拉取 / 测试只带 providerId 时用库里的 baseUrl，换地址（含 PATCH 服务商）必须同时重填 key；余额只查 https 的官方 DeepSeek 账号，响应只投影声明字段。
- 出站代理：地址只在 `.env` 的 `OUTBOUND_PROXY_URL`（不读 `HTTPS_PROXY` / `NO_PROXY`），`LLMService` 持有唯一的代理 agent，模型请求按服务商 `useProxy` 显式传代理或直连 dispatcher，不替换进程的全局 dispatcher；勾选了但没配时失败（`llm_network`），不静默直连。进文案、接口与日志的只有去掉凭据的 `协议://主机:端口`。
- 家族协议事实（thinking / reasoning_effort 取值）只在 `@agent/contracts` 的 `LLM_FAMILY_CAPABILITIES` 一处。
- 管理台「模型调用」口径同源：有 usage 或以 llm_* 类别失败的 action sampling 才算，运行列表与 Run Trace 走 `sampling-usage.projector.ts` 的 `aggregateRunModelCalls`，概览 SQL 复用同文件的 `LLM_CALL_ERROR_CODES`；改一处要同步另一处。

## 验证

`pnpm --filter @agent/api typecheck`、`lint`；单测按 `apps/api/package.json` 的 `test:*` 分组跑；涉及 schema 时 `pnpm prisma:generate` 与 `pnpm exec prisma validate`。
