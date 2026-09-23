# apps/api 导图

NestJS API。给模型的路径导图：只写入口、分层、核心文件与不变量，能 `ls` 看出来的不写。新增 / 移动 / 删除这里提到的模块或核心文件时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 入口与分层

```txt
src/main.ts                      # 启动，全局前缀 /api，端口 PORT（默认 3000）
src/app.module.ts                # 装配所有业务模块
src/common/bootstrap/register-app-globals.ts   # 全局校验管道 / 响应包装 / 异常过滤 / requestId；Controller 不重复实现
Controller -> Service -> AgentRuntime -> LLMService / ToolRegistry -> Prisma
```

Prisma schema 在仓库根 `prisma/`，生成的 client 在 `src/generated/prisma`（不手改）。

## 模块

| 目录 | 职责 | 核心文件 |
| --- | --- | --- |
| `chat/` | 前台对话入口：DTO、系统提示词、NDJSON 流协议适配 | `chat.controller.ts`（`POST /api/chat/stream`）、`chat.service.ts`、`prompts/` |
| `agent-runtime/` | 一次用户输入的 AgentRun 编排；子目录按领域分：`context`（模型可见上下文）、`sampling`（采样决策 / 调试捕获）、`grounding`（证据与引用校验）、`lifecycle`（Run / Step 记录与取消）、`configuration`（运行策略） | `agent-runtime.service.ts`（主循环）、`agent-runtime.types.ts`；细节见目录内 `README.md` |
| `tools/` | Tool Calling：注册、参数校验、执行、Observation 预算；`articles/`、`retrieval/` 是具体工具 | `tool-definitions.ts`（工具清单）、`core/tool-registry.service.ts`、`core/tool-invocation.service.ts` |
| `retrieval/` | 文章检索契约、策略与评估 | `article-retrieval.ts`、`hybrid-article-retrieval.runtime.ts`；见目录 `README.md` |
| `article-indexing/` | 文章分块与向量索引 | `article-chunking.ts`（Facade）、`article-indexer.ts`；见目录 `README.md` |
| `embeddings/` | Gemini embedding 接入，常量在 `embedding-provider.ts` | `gemini-embedding.provider.ts` |
| `llm/` | LLM 的 Nest 壳（读侧）：模型行解析、密钥 cipher 唯一持有、前台模型下拉与余额 | `llm.service.ts`（`@agent/ai` 门面）、`llm-model-config.service.ts`（`resolveModel` / `listVisibleModels`）、`api-key-cipher.ts`、`llm-runtime-config.service.ts`（只读 env，不对外导出） |
| `admin-llm/` | LLM 配置的写侧：服务商 / 模型 CRUD、拉取、探测、导入预设 | `admin-llm.service.ts`、`llm-model-presets.ts`（按家族的官方上限与默认强度） |
| `conversations/` | 会话与消息的 CRUD | `conversations.service.ts`、`messages.service.ts` |
| `admin-runs/` `admin-conversations/` `admin-overview/` | 管理台只读投影 | `admin-runs/projection/`（Run Trace 读模型）；见 `admin-runs/README.md` |
| `prisma/` | `PrismaService` 与连接可靠性 | `prisma.service.ts` |
| `common/` | 全局管道 / 拦截器 / 过滤器 / 中间件 / 工具 | `bootstrap/register-app-globals.ts` |

## 不变量

- 模型看到的必须能从持久化记录重建：这是 R1 目标，当前不完全成立，缺口见根 `AGENTS.md` 第 6 节；`AgentStep` 是系统执行过程，不是模型思考链。
- 模型输出不可信：工具名、参数、引用 key 先校验再执行；检索正文按 untrusted data 注入。
- 终态所有权：晚到的 Abort / deadline / DB 结果不能覆盖已确立终态。
- 服务商 API Key 只以密文入库，任何接口只回显尾四位；主密钥 `AGENT_SECRET_KEY` 只在 `llm/` 内使用。
- 家族协议事实（thinking / reasoning_effort 取值）只在 `@agent/contracts` 的 `LLM_FAMILY_CAPABILITIES` 一处。

## 验证

`pnpm --filter @agent/api typecheck`、`lint`；单测按 `apps/api/package.json` 的 `test:*` 分组跑；涉及 schema 时 `pnpm prisma:generate` 与 `pnpm exec prisma validate`。
