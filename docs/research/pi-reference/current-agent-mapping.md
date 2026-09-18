# 对照我们当前的 Agent

基线：`4e53bf681b9958ceac6991280cedbdad35612e80`。这些是本次读取代码的快照；实际生效环境变量和线上运行状态不在本次验证范围。

## 1. 已有基础与真实差异

| 主题 | agent 当前源码事实 | Pi 对照 | 后续方向 |
| --- | --- | --- | --- |
| 入口与产品 | `SeoController → SeoService → AgentRuntimeService.runTurnStream`；Runtime 已独立目录 | 普通 coding-agent 负责产品，Agent/Models 提供机制 | 后续抽离 SEO 命名与产品组合，先明确能力面，不因目录名直接重写 |
| 模型边界 | `LLMService` / 自有 `ModelInputItem` / `ModelStreamEvent` / OpenAI-compatible client | `Models` / provider adapter / assistant frame | 保留自有契约，把 provider 兼容留在 adapter；Responses 第二 wire 随 #117 转 Gated，不做 |
| 模型重试 | `OpenAICompatibleClient.createClient()` 常量 `maxRetries: 2`，交给 openai SDK 内置重试，边界为首个响应头之前；`chatStream` 内 abort 与 `create()` 竞速、派生一次性 signal（#115，2026-09-18 合并） | Pi 有 adapter request retry（`maxRetryDelayMs` 封顶），也有 durable runtime 的 attempt/retry_wait | 请求前重试已做；已产生输出后的新 attempt 属 session 事件流 / replay 阶段 |
| 工具循环 | 默认 `maxSamplingRounds: 10`、`maxToolCalls: 8`（#115），两个上限相互独立（#116 删除 `maxToolCalls < maxSamplingRounds` 耦合）；`maxToolCalls` 按 call 计数，同轮 call 数超过剩余预算时在执行任何 call 之前整体抛 `AgentLoopLimitExceededError` | 旧 Agent loop 无轮次上限，靠 `shouldStopAfterTurn`；新 Drive 靠 durable 状态与 retry attempt 上限 | 已按 #116 落地（2026-09-19 合并） |
| 同轮输出 | `streamModelSampling` 只按 `finishReason` 分派：本轮 = 可选文本 + 一个或多个 Tool Call（`SamplingDecision.tool_call.calls[]`），顺序执行；`length` 截断整批不执行、逐 call 记 `truncated_arguments` 回喂；流协议不变量（含 reasoning_content 必需、同批 call id 不重复、`length` 例外）只在 `packages/ai` adapter 一处（#116，2026-09-19 合并） | Pi assistant content 可同时含 text/toolCall；adapter 对 DeepSeek 用 `requiresReasoningContentOnAssistantMessages` 表达同一约束；Pi 截断用 `failToolCallsFromTruncatedMessage` 整批回喂 | 并行 Tool Call 仍后置 |
| 流协议与取消 | 统一 NDJSON：`start / delta / done / error / aborted` 五种事件（[contracts/seo.ts:29](/Users/ayu/Desktop/agent/packages/contracts/src/seo.ts:29)）；`RunCancellation` 三个来源 user / deadline / failure，`completing → completed` 处理 COMMIT 不确定态（[run-cancellation.ts:12](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/lifecycle/run-cancellation.ts:12)）；`runDeadlineMs` 默认 600s | Pi 的 live 事件与 durable entry 分离；取消是 `cancel_requested` 标记 + reconcile，不是 signal | R2/R4 的直接基线：先在这套事件与取消语义上加 operation ID 与 snapshot/cursor，不另起协议 |
| 上下文 | source-aware `ModelContext`、每轮 `SamplingContextPlanner`、历史预算/Observation 治理 | branch context、compaction、request transforms | 保留预算与不可信数据边界；建立可持久化有效输入的契约 |
| 运行记录 | Prisma Conversation / Message / AgentRun / AgentStep；Step input/output 记录统计及可选 debug payload | 旧 JSONL 与新 Session 的 branch/op/journal 是不同层级 | AgentStep 不是可恢复 operation journal，不能直接当 replay 驱动日志 |
| 断线 | HTTP `close` 且响应未正常结束 → AbortController.abort；继续 drain generator 完成 ABORTED 收口 | durable 路径将 observer、attachment、lane operation 分开 | 云端运行独立于订阅，需要改变命令/观察协议与所有权；不能只删 abort |
| Grounding | EvidenceRegistry、structured finalization、服务端 Citation identity 校验、MessageGrounding、Web/Admin typed projection | Pi 核心不替我们提供这套 RAG 引用事实 | 保留为我们的产品能力，迁移时放在明确的 runtime 扩展边界 |
| 安全 | 模型 Tool Call 先校验，Observation 治理；api 目前没有任何 Nest Guard，即零鉴权，Admin Task 4 的 Auth/RBAC 仍 Planned | 本机默认权限，实验 protocol 也不等于租户授权 | 云端使用外部写操作前落实身份、scope、审批与隔离；这是比 Pi 缺口更早要补的项 |

源码入口：

- [Runtime 导航](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/README.md)
- [policy](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/configuration/agent-runtime.policy.ts:7)
- [SamplingDecision](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/sampling/model-sampling-decision.ts:21)
- [LLM client](/Users/ayu/Desktop/agent/packages/ai/src/api/openai-completions.ts:187)
- [HTTP 断线](/Users/ayu/Desktop/agent/apps/api/src/seo/seo.controller.ts:43)
- [Prisma 事实层](/Users/ayu/Desktop/agent/prisma/schema.prisma:59)

## 2. 最容易混淆的现状：可观测不等于可恢复

当前 [Runtime](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/agent-runtime.service.ts:332) 原文节选：

```ts
// debug 捕获暂存：只有 AGENT_DEBUG_CAPTURE_MODEL_IO 开启时 client 才会回调，
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
    configuration/  # 已有：一次 run 的 resolved config
    context/        # 已有：source-aware context 与预算
    sampling/       # 已有：模型事件到业务决策
    lifecycle/      # 已有：Run/Step 与取消、deadline
    grounding/      # 已有：引用事实与 finalization
  llm/              # 已有：Nest 壳（LlmModule / LLMController / LLMService 门面 / LLMRuntimeConfigService）
  tools/            # 已有：registry/invocation/observation 归一化（硬上限 128k 字符）
packages/ai/        # 已有（#120）：OpenAICompatibleClient、流适配、ModelStreamEvent / ModelInputItem / ModelToolSpec、LLM 错误、model profile、resolveLLMRuntimeConfig；零 Nest、零 Prisma
packages/contracts/ # 已有：ChatStreamEvent、MessageGroundingV1、AgentRun/AgentStep 投影；R1/R4 改协议先动这里
```

R2 起新写的循环、operation 状态、工具契约进 `packages/agent`，并依赖 `@agent/ai` 的模型类型；上面各目录按被替换的节奏迁入，Grounding 拆校验规则进包、落库留 apps。对应 Issue 定案前不建新目录。

## 4. 迁移时必须保留的东西

1. 终态所有权与 COMMIT 不确定性的诚实表达；新恢复逻辑不能覆盖已确立的终态。
2. Tool Call / Result 配对、来源 identity、runtime policy 与 deadline；减少代码不能减少边界检查。
3. Grounding Session 之后的草稿隐藏、引用 identity 校验、持久化 Grounding 与前端 fail-closed normalization。
4. Web/Admin 的 typed projection 与脱敏边界。Pi 的 transcript 不应直接代替我们的 UI/API contract。
5. 当前可运行链路。正式改动逐 Issue 验证，不以“像 Pi”为理由一次迁移数据库、流协议与整个前端。

## 5. 当前状态不由研究重写

任务状态与顺序以 `docs/tasks/README.md` 看板为准，本文不重复。#115–#120 的规格只存在于 GitHub Issue 与看板行，`docs/tasks/` 下没有对应任务文件，不要去找。研究不修改这些状态，也不声明当前项目源码学习已由用户完成。
