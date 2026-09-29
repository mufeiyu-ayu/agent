# 当前源码配置地图

本文是阅读导航，不是运行时事实来源；每类配置的事实来源永远是对应源码文件。Issue #92 建立，2026-09-29 按 #216 之后的代码核对。

## 配置分类与事实来源

| 类别 | 含义 | 事实来源 | 校验时机 |
| --- | --- | --- | --- |
| 环境配置（LLM） | 主密钥 `AGENT_SECRET_KEY`、出站代理 `OUTBOUND_PROXY_URL`；服务商地址 / API Key / 模型名与能力在数据库 `LlmProvider` / `LlmModel`，由管理台维护 | `apps/api/src/llm/llm-runtime-config.service.ts`（`resolveLlmEnvConfig`）；数据库配置经 `apps/api/src/llm/llm-model-config.service.ts` 在每个 Run 开始时解析成快照 | env：Nest 启动期 fail-fast；模型行：Admin 写入时校验，Run 开始时解析 |
| 运行配置 | 运行限制（history 候选上限、sampling 轮数、Tool Call 预算、Run deadline）、调试抓取开关、联网搜索的 Serper Key（加密存放、只回显尾四位）；单行表 `RuntimeConfig`，由管理台「运行配置」维护，没有环境变量兜底 | 数据库（`prisma/schema.prisma`）；读写都在 `apps/api/src/runtime-config/runtime-config.service.ts`（`loadSnapshot` / `update`），数值范围是 contracts 的 `RUNTIME_CONFIG_LIMITS` | Admin 写入时 DTO 校验；每次问答开始前读一次，行缺失或读库失败返回 503 |
| 环境配置（数据库） | `DATABASE_URL`、操作 deadline | `apps/api/src/prisma/prisma.service.ts` | 连接时 |
| 模型行 | 服务商地址与加密 API Key（`LlmProvider`）、wireName / context window / 单次输入上限 / 输出上限 / 默认 `reasoningEffort` / 前台可见与默认（`LlmModel`），由管理台「模型接入」人工维护，不从接口猜 | 数据库（`prisma/schema.prisma`）；写侧 `apps/api/src/admin-llm/admin-llm.service.ts`（`assertModelRowValid` / `assertInputBudget`）与导入预设 `llm-model-presets.ts`（安全余量 `INPUT_SAFETY_MARGIN_TOKENS`）；读侧 `apps/api/src/llm/llm-model-config.service.ts`（`resolveModel` 在每个 Run 前解析成快照）；前台下拉只读 `/api/llm/models`，不再有前端名单 | Admin 写入时校验；Run 开始前解析 |
| 家族协议差异 | 各家族的 thinking 格式、Tool Call 是否必须回 `reasoning_content`、`reasoning_effort` 可选值（#142 / #146） | `packages/contracts/src/admin-llm.ts` 的 `LLM_FAMILY_CAPABILITIES` compat 表 | 编译期 |
| 请求级覆盖 | HTTP 请求可选 `model`（模型行 id）与 `reasoningEffort`；请求体没有 temperature / maxTokens，模型名与输出上限只取模型行 | `apps/api/src/chat/dto/chat.dto.ts`（`reasoningEffort` 按 `REASONING_EFFORTS` 做 `IsIn`）→ `LlmModelConfigService.resolveModel`（模型不存在 / 不可见 / Provider 停用 / 强度不属于该家族即不可用）→ `packages/ai/src/config.ts`（`resolveChatRequestConfig`：请求级只能覆盖 `reasoningEffort`） | DTO 走全局校验；不可用模型由 `ChatService` 转 400 |
| 单次 Run 组合配置 | 一次 Agent Run 的 resolved 请求配置 + 模型可见 Tool | `apps/api/src/agent-runtime/agent-runtime.service.ts`（私有方法 `resolveRunConfiguration`；模型可见 Tool 直接取 `apps/api/src/tools/tool-definitions.ts` 的 `TOOL_DEFINITIONS`，它由唯一的工具清单 `TOOLS` 派生，与 Admin 投影共用，#189 起不再经 Registry 核对） | Run 内、AgentRun 落库后解析 |
| Tool Policy | 每个 Tool 的 timeout、Observation 预算（`risk / requiresApproval / idempotent` 已于 #136 删除，审批状态到 R3 按运行时设计重加） | 各 Tool 自己的 definition（`apps/api/src/tools/**`，类型见 `tools/core/tool.types.ts`） | 注册时 + 编译期 |
| 公共契约 | 前后端共享协议与类型 | `packages/contracts/` | 编译期 |
| 算法不变量 | TokenEstimator、首轮历史裁剪（planner）、Observation 硬上限等 | 各算法文件内常量与函数（如 `initial-context.ts`、`sampling-context-planner.ts`、`tool-observation.ts`） | 不可由环境变量改变 |
| 部署变量说明 | 各环境变量的示例与注释 | `.env.example` | 无（文档性质） |

以上未列出的 env 读取点（如 `main.ts` 端口、DB 测试专用的 `TEST_DATABASE_URL`）以 `.env.example` 与对应源码为准；本表只收录长期配置边界。

## 单次 Run 的配置解析链

```text
ChatService → LlmModelConfigService.resolveModel()（模型行 + Provider 凭据快照，作为 input.model 传入 Runtime）
            → RuntimeConfigService.loadSnapshot()（运行限制 + 调试开关 + Serper Key 快照，作为 input.runtimeConfig 传入 Runtime）

input.runtimeConfig.limits ────────────────────────────┐
resolveChatRequestConfig(input.model.profile)（@agent/ai）─┼─→ AgentRuntimeService.resolveRunConfiguration()
TOOL_DEFINITIONS（由工具清单 TOOLS 派生）─────────────┘        │
                                                          ▼
                                          { request, modelTools }
                                                          │
                                                          ▼
                                               AgentRuntimeService.runTurnStream()
                     （Initial Context 与 Sampling 共用同一份 request）
```

要点：

- 本轮用哪个模型行、哪把 Provider 凭据看 `ChatService` 调的 `resolveModel`；输入预算就是模型行的 `maxInputTokens`（保存时校验不超过窗口 − 输出上限 − 安全余量，运行时不再截小），暴露哪些 Tool 看工具清单 `tools/tool-definitions.ts`。
- 调试抓取只在快照的 `debugCaptureModelIo` 打开时给 client 传 `debugCapture` 回调；Serper Key 随工具执行上下文交给 `web_search`，没配或解不开只让搜索失败。
- 模型行的数值约束只在 Admin 写入时由 `assertModelRowValid` 把关；Runtime 与 `@agent/ai` client 不再重校验，不会产生第二份事实。
- 配置解析时机保持在 userMessage / AgentRun 落库之后：请求级配置错误仍走既有 `failRun` 终态化。
- 运行配置在 `ChatService` 里、写入任何消息之前读取；读不到直接 503，不创建 Run。Run deadline 取快照里的值，先于可能抛错的请求解析，运行限制作为参数传入 `resolveRunConfiguration`。

## 边界纪律

- `resolveRunConfiguration` 只组合单次 Run 所需配置；数据库、Admin 等应用配置不得进入。
- 各领域配置的定义与校验留在各自边界；组合入口不重新实现解析。
