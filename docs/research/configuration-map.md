# 当前源码配置地图（Issue #92）

本文是阅读导航，不是运行时事实来源；每类配置的事实来源永远是对应源码文件。基线：Issue #92 合入后的 `apps/api`。

## 配置分类与事实来源

| 类别 | 含义 | 事实来源 | 校验时机 |
| --- | --- | --- | --- |
| 环境配置（LLM） | API Key、Base URL、默认模型、超时、输出预算上限 | `packages/ai/src/config.ts`（`resolveLLMRuntimeConfig`，由 `apps/api/src/llm/llm-runtime-config.service.ts` 在启动期调用） | Nest 启动期 fail-fast |
| 环境配置（Run Policy） | history 候选批量 / 上限、sampling 轮数、Tool Call 预算、Run deadline | `apps/api/src/agent-runtime/configuration/agent-runtime.policy.ts`（`resolveAgentRuntimePolicy`） | Nest 启动期 fail-fast |
| 环境配置（Embedding） | Gemini API Key、批量、重试、请求超时 | `apps/api/src/embeddings/embedding-provider.ts` | 构建 provider 时解析 |
| 环境配置（数据库） | `DATABASE_URL`、操作 deadline | `apps/api/src/prisma/prisma.service.ts` | 连接时 |
| 环境配置（检索运行时） | 混合检索装配所需的 env | `apps/api/src/retrieval/hybrid-article-retrieval.runtime.ts` | 装配时 |
| Provider 模型能力 | 支持模型名单 + 每个模型的 context window / Provider 输出上限 | `packages/ai/src/deepseek.ts`（LLM 领域单点；前端另有展示用名单 `apps/web/src/types/llm.ts`，新增模型需同步） | 编译期 `Record` 双向约束 |
| 请求级覆盖 | HTTP 请求可覆盖 model（`SeoChatDto` 白名单校验）；temperature / maxTokens 目前只由服务端调用方设置（`SeoService` 固定 temperature 0.4，maxTokens 未使用） | `packages/ai/src/config.ts`（`resolveChatRequestConfig` → `ResolvedChatRequestConfig`） | model / maxTokens 解析时抛 `LLMConfigError`；temperature 无范围校验，仅缺省补 0.7——未来暴露给 HTTP 前必须先加 DTO 校验 |
| 单次 Run 组合配置 | 一次 Agent Run 的 resolved 请求配置 + Tool allowlist | `apps/api/src/agent-runtime/agent-runtime.service.ts`（私有方法 `resolveRunConfiguration`；allowlist 常量 `AGENT_RUN_TOOL_NAMES` 同文件） | Run 内、AgentRun 落库后解析 |
| Tool Policy | 每个 Tool 的 timeout、Observation 预算、risk、approval、evidence policy | 各 Tool 自己的 definition（`apps/api/src/tools/**`，类型见 `tools/core/tool.types.ts`） | 注册时 + 编译期 |
| 公共契约 | 前后端共享协议与类型 | `packages/contracts/` | 编译期 |
| 算法不变量 | Context budget 比例、TokenEstimator、首轮历史裁剪（planner）、Observation 硬上限等 | 各算法文件内常量与函数（如 `initial-context.ts`、`sampling-context-planner.ts`、`tool-observation.ts`） | 不可由环境变量改变 |
| 部署变量说明 | 各环境变量的示例与注释 | `.env.example` | 无（文档性质） |

以上未列出的 env 读取点（如 `main.ts` 端口、各 smoke / CLI 专用变量）以 `.env.example` 与对应源码为准；本表只收录长期配置边界。

## 单次 Run 的配置解析链

```text
AgentRuntimePolicyService.value（启动期已校验）─┐
LLMService.resolveChatRequestConfig ────────────┼─→ AgentRuntimeService.resolveRunConfiguration()
ToolRegistryService.get(name) ──────────────────┘        │
                                                          ▼
                                          { request, toolDefinitions, modelTools }
                                                          │
                                                          ▼
                                               AgentRuntimeService.runTurnStream()
                     （Initial Context、Sampling、Grounded finalization 共用同一份 request）
```

要点：

- 回答“本轮用什么模型、多大预算、暴露哪些 Tool”，只读 `agent-runtime.service.ts` 的 `resolveRunConfiguration` 一个入口。
- `ResolvedChatRequestConfig` 携带 `contextWindowTokens`，Runtime 不再穿透 LLM 边界补查 Model Profile。
- Provider Client 端对已 resolved 值的重校验是确定性 fail-fast，不会产生第二份事实。
- 配置解析时机保持在 userMessage / AgentRun 落库之后：请求级配置错误仍走既有 `failRun` 终态化。
- policy 在 Run deadline 建立时读取一次（启动期已校验、非抛错），先于可能抛错的请求解析，并作为参数传入 `resolveRunConfiguration`。

## 边界纪律

- `resolveRunConfiguration` 只组合单次 Run 所需配置；数据库、Embedding、Admin 等应用配置不得进入。
- 各领域配置的定义与校验留在各自边界；组合入口不重新实现解析。
- Grounding / Citation / Evidence 的公共字段限制不在本地图范围（见 Issue #92 D-11，另行立项）。
