# 对照我们当前的 Agent

基线：`4e53bf681b9958ceac6991280cedbdad35612e80`。这些是本次读取代码的快照；实际生效环境变量和线上运行状态不在本次验证范围。

## 1. 已有基础与真实差异

| 主题 | agent 当前源码事实 | Pi 对照 | 后续方向 |
| --- | --- | --- | --- |
| 入口与产品 | `SeoController → SeoService → AgentRuntimeService.runTurnStream`；Runtime 已独立目录 | 普通 coding-agent 负责产品，Agent/Models 提供机制 | 后续抽离 SEO 命名与产品组合，先明确能力面，不因目录名直接重写 |
| 模型边界 | `LLMService` / 自有 `ModelInputItem` / `ModelStreamEvent` / OpenAI-compatible client | `Models` / provider adapter / assistant frame | 保留自有契约，把 provider 兼容留在 adapter；#117 再加 Responses |
| 模型重试 | `OpenAICompatibleClient.createClient()` 明确 `maxRetries: 0` | Pi 有 adapter request retry，也有 durable runtime 的 attempt/retry_wait | #115 已建，先分清请求前重试与已产生输出后的新 attempt |
| 工具循环 | 默认 `maxSamplingRounds: 3`、`maxToolCalls: 2`；可由启动期环境覆盖 | 旧 Agent loop 与新 Drive 都支持工具续轮 | #115 的新默认值是计划，不是当前事实 |
| 同轮输出 | `streamModelSampling` 拒绝文本之后 Tool Call 与同轮多个工具 | Pi assistant content 可同时含 text/toolCall；新 runtime 支持调度与顺序发布 | 按 #116 先实现顺序多工具；不顺带开并行 |
| 上下文 | source-aware `ModelContext`、每轮 `SamplingContextPlanner`、历史预算/Observation 治理 | branch context、compaction、request transforms | 保留预算与不可信数据边界；建立可持久化有效输入的契约 |
| 运行记录 | Prisma Conversation / Message / AgentRun / AgentStep；Step input/output 记录统计及可选 debug payload | 旧 JSONL 与新 Session 的 branch/op/journal 是不同层级 | AgentStep 不是可恢复 operation journal，不能直接当 replay 驱动日志 |
| 断线 | HTTP `close` 且响应未正常结束 → AbortController.abort；继续 drain generator 完成 ABORTED 收口 | durable 路径将 observer、attachment、lane operation 分开 | 云端运行独立于订阅，需要改变命令/观察协议与所有权；不能只删 abort |
| Grounding | EvidenceRegistry、structured finalization、服务端 Citation identity 校验、MessageGrounding、Web/Admin typed projection | Pi 核心不替我们提供这套 RAG 引用事实 | 保留为我们的产品能力，迁移时放在明确的 runtime 扩展边界 |
| 安全 | 模型 Tool Call 先校验，Observation 治理；尚无完整多租户审批/沙箱体系 | 本机默认权限，实验 protocol 也不等于租户授权 | 云端使用外部写操作前落实身份、scope、审批与隔离 |

源码入口：

- [Runtime 导航](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/README.md)
- [policy](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/configuration/agent-runtime.policy.ts:7)
- [SamplingDecision](/Users/ayu/Desktop/agent/apps/api/src/agent-runtime/sampling/model-sampling-decision.ts:21)
- [LLM client](/Users/ayu/Desktop/agent/apps/api/src/llm/clients/openai-compatible.client.ts:192)
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

## 3. 目录映射建议

无需先复制 Pi 的 monorepo。当前目录已有按职责分层，优先在这里补边界：

```text
apps/api/src/
  agent-runtime/
    configuration/  # 已有：一次 run 的 resolved config
    context/        # 已有：source-aware context 与预算
    sampling/       # 已有：模型事件到业务决策
    lifecycle/      # 已有：Run/Step 与取消、deadline
    grounding/      # 已有：引用事实与 finalization
    session/        # 候选：事件、分支、快照、rebuild
    operations/     # 候选：accept/drive/checkpoint 与恢复
  llm/              # 已有：provider adapters
  tools/            # 已有：registry/invocation；候选 journal/receipt
packages/contracts/ # 已有：UI/API 公开投影，避免导出所有内部日志
```

两个“候选”目录只有在对应 Issue 定案后才建立。不先抽 `packages/runtime`，也不先建 Chord 风格通用 service runtime；等真正出现第二个宿主（独立 worker/SDK）再证明抽包的收益。

## 4. 迁移时必须保留的东西

1. 终态所有权与 COMMIT 不确定性的诚实表达；新恢复逻辑不能覆盖已确立的终态。
2. Tool Call / Result 配对、来源 identity、runtime policy 与 deadline；减少代码不能减少边界检查。
3. Grounding Session 之后的草稿隐藏、引用 identity 校验、持久化 Grounding 与前端 fail-closed normalization。
4. Web/Admin 的 typed projection 与脱敏边界。Pi 的 transcript 不应直接代替我们的 UI/API contract。
5. 当前可运行链路。正式改动逐 Issue 验证，不以“像 Pi”为理由一次迁移数据库、流协议与整个前端。

## 5. 当前状态不由研究重写

`docs/tasks/README.md` 当前为 Phase 1–8 Completed、无 Active、Next #115，后续 #116 → #117；Admin Task 4 Planned。本次研究不修改这些状态，也不声明当前项目源码学习已由用户完成。
