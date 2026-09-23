# 当前源码配置地图

本文是阅读导航，不是运行时事实来源；每类配置的事实来源永远是对应源码文件。Issue #92 建立，2026-09-23 按 #137 / #142 / #146 之后的代码核对。

## 配置分类与事实来源

| 类别 | 含义 | 事实来源 | 校验时机 |
| --- | --- | --- | --- |
| 环境配置（LLM） | 主密钥 `AGENT_SECRET_KEY`、debug 开关 `AGENT_DEBUG_CAPTURE_MODEL_IO`；服务商地址 / API Key / 模型名与能力自 #142 起在数据库 `LlmProvider` / `LlmModel`，由管理台维护 | `apps/api/src/llm/llm-runtime-config.service.ts`（`resolveLlmEnvConfig`）；数据库配置经 `apps/api/src/llm/llm-model-config.service.ts` 在每个 Run 开始时解析成快照 | env：Nest 启动期 fail-fast；模型行：Admin 写入时校验，Run 开始时解析 |
| 环境配置（Run Policy） | history 候选上限、sampling 轮数、Tool Call 预算、Run deadline（`AGENT_HISTORY_CANDIDATE_HARD_LIMIT` / `AGENT_MAX_SAMPLING_ROUNDS` / `AGENT_MAX_TOOL_CALLS` / `AGENT_RUN_DEADLINE_MS`） | `apps/api/src/agent-runtime/configuration/agent-runtime.policy.ts`（`resolveAgentRuntimePolicy`） | Nest 启动期 fail-fast |
| 环境配置（Embedding） | 只剩 `GEMINI_API_KEY`；批量 64、单次尝试超时 60s、重试 2 次自 #137 起是同文件常量 | `apps/api/src/embeddings/embedding-provider.ts` | 构建 provider 时解析 |
| 环境配置（数据库） | `DATABASE_URL`、操作 deadline | `apps/api/src/prisma/prisma.service.ts` | 连接时 |
| 环境配置（检索运行时） | 混合检索装配所需的 env | `apps/api/src/retrieval/hybrid-article-retrieval.runtime.ts` | 装配时 |
| 模型行 | 服务商地址与加密 API Key（`LlmProvider`）、wireName / context window / 输出上限 / 默认 `reasoningEffort` / 前台可见与默认（`LlmModel`），由管理台「模型接入」人工维护，不从接口猜 | 数据库（`prisma/schema.prisma`）；写侧 `apps/api/src/admin-llm/admin-llm.service.ts`（`assertModelRowValid`）与导入预设 `llm-model-presets.ts`；读侧 `apps/api/src/llm/llm-model-config.service.ts`（`resolveModel` 在每个 Run 前解析成快照）；前台下拉只读 `/api/llm/models`，不再有前端名单 | Admin 写入时校验；Run 开始前解析 |
| 家族协议差异 | 各家族的 thinking 格式、Tool Call 是否必须回 `reasoning_content`、`reasoning_effort` 可选值（#142 / #146） | `packages/contracts/src/admin-llm.ts` 的 `LLM_FAMILY_CAPABILITIES` compat 表 | 编译期 |
| 请求级覆盖 | HTTP 请求可选 `model`（模型行 id）与 `reasoningEffort`；请求体没有 temperature / maxTokens，模型名与输出上限只取模型行 | `apps/api/src/chat/dto/chat.dto.ts`（`reasoningEffort` 按 `REASONING_EFFORTS` 做 `IsIn`）→ `LlmModelConfigService.resolveModel`（模型不存在 / 不可见 / Provider 停用 / 强度不属于该家族即不可用）→ `packages/ai/src/config.ts`（`resolveChatRequestConfig`：请求级只能覆盖 `reasoningEffort`） | DTO 走全局校验；不可用模型由 `ChatService` 转 400 |
| 单次 Run 组合配置 | 一次 Agent Run 的 resolved 请求配置 + Tool allowlist | `apps/api/src/agent-runtime/agent-runtime.service.ts`（私有方法 `resolveRunConfiguration`；allowlist 来自 `apps/api/src/tools/tool-definitions.ts` 的 `TOOL_DEFINITIONS`，#136 起与 Admin 投影共用） | Run 内、AgentRun 落库后解析 |
| Tool Policy | 每个 Tool 的 timeout、Observation 预算、evidence policy（`risk / requiresApproval / idempotent` 已于 #136 删除，审批状态到 R3 按运行时设计重加） | 各 Tool 自己的 definition（`apps/api/src/tools/**`，类型见 `tools/core/tool.types.ts`） | 注册时 + 编译期 |
| 公共契约 | 前后端共享协议与类型 | `packages/contracts/` | 编译期 |
| 算法不变量 | Context budget 比例、TokenEstimator、首轮历史裁剪（planner）、Observation 硬上限等 | 各算法文件内常量与函数（如 `initial-context.ts`、`sampling-context-planner.ts`、`tool-observation.ts`） | 不可由环境变量改变 |
| 部署变量说明 | 各环境变量的示例与注释 | `.env.example` | 无（文档性质） |

以上未列出的 env 读取点（如 `main.ts` 端口、各 smoke / CLI 专用变量）以 `.env.example` 与对应源码为准；本表只收录长期配置边界。

## 单次 Run 的配置解析链

```text
ChatService → LlmModelConfigService.resolveModel()（模型行 + Provider 凭据快照，作为 input.model 传入 Runtime）

AgentRuntimePolicyService.value（启动期已校验）───────┐
resolveChatRequestConfig(input.model.profile)（@agent/ai）─┼─→ AgentRuntimeService.resolveRunConfiguration()
ToolRegistryService.get(name) ────────────────────────┘        │
                                                          ▼
                                          { request, toolDefinitions, modelTools }
                                                          │
                                                          ▼
                                               AgentRuntimeService.runTurnStream()
                     （Initial Context、Sampling、Grounded finalization 共用同一份 request）
```

要点：

- 本轮用哪个模型行、哪把 Provider 凭据看 `ChatService` 调的 `resolveModel`；多大预算、暴露哪些 Tool 看 `agent-runtime.service.ts` 的 `resolveRunConfiguration`。
- `ResolvedChatRequestConfig` 携带 `contextWindowTokens`，Runtime 不再穿透 LLM 边界补查 Model Profile。
- Provider Client 端对已 resolved 值的重校验是确定性 fail-fast，不会产生第二份事实。
- 配置解析时机保持在 userMessage / AgentRun 落库之后：请求级配置错误仍走既有 `failRun` 终态化。
- policy 在 Run deadline 建立时读取一次（启动期已校验、非抛错），先于可能抛错的请求解析，并作为参数传入 `resolveRunConfiguration`。

## 边界纪律

- `resolveRunConfiguration` 只组合单次 Run 所需配置；数据库、Embedding、Admin 等应用配置不得进入。
- 各领域配置的定义与校验留在各自边界；组合入口不重新实现解析。
- Grounding / Citation / Evidence 的公共字段限制不在本地图范围（见 Issue #92 D-11，另行立项）。
