# 对照我们当前的 Agent

基线：`4e53bf681b9958ceac6991280cedbdad35612e80`。这些是本次读取代码的快照；实际生效环境变量和线上运行状态不在本次验证范围。

## 1. 已有基础与真实差异

| 主题 | agent 当前源码事实 | Pi 对照 | 后续方向 |
| --- | --- | --- | --- |
| 入口与产品 | `ChatController → ChatService → AgentRuntimeService.runTurnStream`；Runtime 已独立目录 | 普通 coding-agent 负责产品，Agent/Models 提供机制 | SEO 命名已于 #134 去掉；产品组合后续再抽离，先明确能力面，不因目录名直接重写 |
| 模型边界 | `LLMService` / 自有 `ModelInputItem` / `ModelStreamEvent` / OpenAI-compatible client | `Models` / provider adapter / assistant frame | 保留自有契约，把 provider 兼容留在 adapter；Responses 第二 wire 随 #117 转 Gated，不做 |
| 模型重试 | `OpenAICompatibleClient.createClient()` 常量 `maxRetries: 2`，交给 openai SDK 内置重试，边界为首个响应头之前；`chatStream` 内 abort 与 `create()` 竞速、派生一次性 signal（#115，2026-09-18 合并） | Pi 有 adapter request retry（`maxRetryDelayMs` 封顶），也有 durable runtime 的 attempt/retry_wait | 请求前重试已做；已产生输出后的新 attempt 属 session 事件流 / replay 阶段 |
| 工具循环 | 不限轮数与工具调用次数（#218）：采样循环直到模型给出最终回答，只由 `runDeadlineMs` 兜底；#115 / #116 的 `maxSamplingRounds`、`maxToolCalls` 与 `AgentLoopLimitExceededError` 已删 | Agent loop 无轮次上限（`packages/agent/src/agent-loop.ts` 的 `while (true)`），靠 `shouldStopAfterTurn`；新 Drive 靠 durable 状态与 retry attempt 上限 | 已照抄 Pi（#218）；长任务的上下文增长由 E3 压缩处理 |
| 同轮输出 | `streamModelSampling` 只按 `finishReason` 分派：本轮 = 可选文本 + 一个或多个 Tool Call（`SamplingDecision.tool_call.calls[]`），顺序执行；`length` 截断整批不执行、逐 call 记 `truncated_arguments` 回喂；流协议不变量（含 reasoning_content 必需、同批 call id 不重复、`length` 例外）只在 `packages/ai` adapter 一处（#116，2026-09-19 合并） | Pi assistant content 可同时含 text/toolCall；adapter 对 DeepSeek 用 `requiresReasoningContentOnAssistantMessages` 表达同一约束；Pi 截断用 `failToolCallsFromTruncatedMessage` 整批回喂 | 并行 Tool Call 仍后置 |
| 流协议与取消 | 统一 NDJSON：`start / delta / done / error / aborted` 五种事件（[contracts/chat.ts](../../../packages/contracts/src/chat.ts)）；`RunCancellation` 三个来源 user / deadline / failure，`completing → completed` 处理 COMMIT 不确定态（[run-cancellation.ts](../../../apps/api/src/agent-runtime/lifecycle/run-cancellation.ts)）；`runDeadlineMs` 默认 600s | Pi 的 live 事件与 durable entry 分离；取消是 `cancel_requested` 标记 + reconcile，不是 signal | R2/R4 的直接基线：先在这套事件与取消语义上加 operation ID 与 snapshot/cursor，不另起协议 |
| 上下文 | source-aware `ModelContext`、每轮 `SamplingContextPlanner`、历史预算/Observation 治理 | branch context、compaction、request transforms | 保留预算与不可信数据边界；建立可持久化有效输入的契约 |
| 运行记录 | Prisma Conversation / Message / AgentRun / AgentStep；Step input/output 记录统计及可选 debug payload | 旧 JSONL 与新 Session 的 branch/op/journal 是不同层级 | AgentStep 不是可恢复 operation journal，不能直接当 replay 驱动日志 |
| 断线 | HTTP `close` 且响应未正常结束 → AbortController.abort；继续 drain generator 完成 ABORTED 收口 | durable 路径将 observer、attachment、lane operation 分开 | 云端运行独立于订阅，需要改变命令/观察协议与所有权；不能只删 abort |
| Grounding | 已删除（#185）：2026-09-26 定案删除 RAG 与 Grounding 全链路（[workbench-direction](../workbench-direction.md) 第 9 节删除记录），只留 `search_articles` 作工具模板（#204 删除，`web_search` 接替） | Pi 核心不提供 RAG 引用事实 | 不再保留；检索、索引与 embedding 的孤儿代码随第 ② 步删除 |
| 安全 | 模型 Tool Call 先校验，Observation 治理；api 目前没有任何 Nest Guard，即零鉴权，Admin Task 4 的 Auth/RBAC 仍 Planned | 本机默认权限，实验 protocol 也不等于租户授权 | 鉴权随第一期上线进工作台方向第 7 节第 1 档（2026-09-27）；审批与副作用隔离随 R3 |

源码入口：

- [Runtime 导航](../../../apps/api/src/agent-runtime/README.md)
- [运行配置](../../../apps/api/src/runtime-config/runtime-config.service.ts)
- [SamplingDecision](../../../apps/api/src/agent-runtime/sampling/model-sampling-decision.ts)
- [LLM client](../../../packages/ai/src/api/openai-completions.ts)
- [HTTP 断线](../../../apps/api/src/chat/chat.controller.ts)
- [Prisma 事实层](../../../prisma/schema.prisma)

## 2. 最容易混淆的现状：可观测不等于可恢复

当前 [Runtime](../../../apps/api/src/agent-runtime/agent-runtime.service.ts) 原文节选：

```ts
// debug 捕获暂存：只有运行配置打开「抓取模型原始请求」时才给 client 回调，
// 开关关闭时始终为空对象，落库输出与现状完全一致。
const debugModelIO: DebugModelIOCaptured = {
  runId: currentAgentRunId,
  samplingAttemptId,
}
```

标注：模型输入保存在这轮内存中的 `contextPlan.items`；普通 Step 的 contextPlan 是统计摘要，完整 request capture 是可选 debug 能力。因此项目约定的 **model-visible ⟺ logged** 是后续 durability 必须满足的不变量，不能据此宣称当前已经拥有任意历史版本下的 exact request replay。

Pi 也有同样需要审慎对待的边界：branch history 可恢复，但 extension/context/provider 变换可能发生在请求期。我们要记录或稳定引用真正发送的 instructions、选中 messages、tools/schema、模型配置、变换版本和受控数据版本。敏感原文的保存权限、保留期限和展示脱敏应与 Debug Inspector 分开设计。

## 3. 目录映射

依赖方向与分包由 [roadmap R2](./roadmap.md) 唯一决定（2026-09-16 定案：`packages/agent` + `packages/ai`，`apps/api` 只做宿主），本节不重复也不另给方向。当前已有目录：

```text
apps/api/src/
  agent-runtime/
    context/        # 已有：source-aware context 与预算
    sampling/       # 已有：模型事件到业务决策
    lifecycle/      # 已有：Run/Step 与取消、deadline
  llm/              # 已有：Nest 壳读侧（LLMService 门面、LlmModelConfigService 解析模型行、api-key-cipher、LLMRuntimeConfigService 只读主密钥与出站代理）
  runtime-config/   # 已有：运行配置单行表（运行限制、调试开关、Serper Key），每次问答读快照传给 runtime
  admin-llm/        # 已有（#142）：模型配置写侧（服务商 / 模型 CRUD、拉取、探测、导入预设）
  tools/            # 已有：registry/invocation/observation 归一化（硬上限 128k 字符）
packages/ai/        # 已有（#120）：OpenAICompatibleClient、流适配、ModelStreamEvent / ModelInputItem / ModelToolSpec、LLM 错误、LLMModelProfile 类型与 resolveChatRequestConfig；零 Nest、零 Prisma。模型行与凭据来自数据库（#142 删了 resolveLLMRuntimeConfig 与硬编码模型表）
packages/contracts/ # 已有：ChatStreamEvent、AgentRun/AgentStep 投影；R1/R4 改协议先动这里
```

R2 起新写的循环、operation 状态、工具契约进 `packages/agent`，并依赖 `@agent/ai` 的模型类型；上面各目录按被替换的节奏迁入。对应 Issue 定案前不建新目录。

## 4. 迁移时必须保留的东西

1. 终态所有权与 COMMIT 不确定性的诚实表达；新恢复逻辑不能覆盖已确立的终态。
2. Tool Call / Result 配对、来源 identity、runtime policy 与 deadline；减少代码不能减少边界检查。
3. Web/Admin 的 typed projection 与脱敏边界。Pi 的 transcript 不应直接代替我们的 UI/API contract。
4. 当前可运行链路。正式改动逐 Issue 验证，不以“像 Pi”为理由一次迁移数据库、流协议与整个前端。

## 5. 当前状态不由研究重写

任务状态与顺序以 `docs/tasks/README.md` 看板为准，本文不重复。#115–#120 的规格只存在于 GitHub Issue 与看板行，`docs/tasks/` 下没有对应任务文件，不要去找。研究不修改这些状态，也不声明当前项目源码学习已由用户完成。
