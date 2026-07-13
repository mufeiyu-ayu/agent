# Phase 09：可观测性、评测与系统化测试

> 模块分类：**Advanced**。测试从 Core 阶段持续加入，完整 telemetry/eval 体系按真实交付需求建设。

## 1. 阶段问题

> 当一次 AgentRun 经过多轮 sampling、工具、审批、压缩、恢复和重连后，我们如何回答“它为什么慢、为什么失败、为什么选错工具、改 prompt/model 后质量是变好还是变差”？

可观测性回答单次和总体运行发生了什么；Evaluation 回答输出是否满足业务目标；自动化测试回答确定性不变量是否被破坏。三者互补，不能互相替代。

## 2. 路线位置

Phase 09 从 Phase 03 起就应持续补基础字段，但在 Phase 07/08 后完成系统化收口：

```text
Tool loop / Approval / Context / Recovery / Resume
  -> correlated traces + metrics + structured logs
  -> fixed SEO eval set + regression command
  -> quality/reliability/cost gate
```

## 3. 学习目标

完成后应能解释并证明：

1. Log、Trace、Metric、Durable Fact、Eval Result 分别回答什么问题。
2. requestId、conversationId、runId、stepId、samplingAttemptId、toolCallId、toolExecutionId 如何关联。
3. 异步 Run 为什么不应始终把 HTTP request span 当唯一父 span。
4. 哪些字段可作为 metric label，哪些会造成高基数爆炸。
5. 如何记录 token、latency、tool/approval/recovery，而不泄漏 prompt、secret 或用户内容。
6. 最终答案质量、工具选择、参数正确性、observation 使用和安全拒绝如何分开评估。
7. deterministic assertions、rubric、LLM judge 和人工复核各自的边界。
8. prompt/model/tool/context policy 版本为何必须进入 trace/eval result。
9. 如何建立可重复 baseline 和 regression gate，而不是凭“看起来更好”。
10. 如何从一次失败 trace 反向沉淀成 unit/integration/recovery/eval case。

## 4. 前置条件

- [ ] Run/Step/Tool/Approval/Context/Recovery 具有稳定 ID 与 reason codes。
- [ ] provider usage/finish reason 可通过 adapter 读取。
- [ ] ContextPlan 有 prompt/context policy version 与估算 token。
- [ ] Tool definitions/version 和 model config 可记录。
- [ ] request id middleware 已存在并贯穿 application boundary。
- [ ] 关键状态机已有自动化测试，不把 production telemetry 当测试替代。
- [ ] secret/output redaction 有集中规则。
- [ ] 至少能导出本地 JSON/report；不要求先接生产监控厂商。

## 5. 当前项目起点

### 已有基础

- `request-id.middleware.ts` 接收或生成 `x-request-id`。
- AgentRun/AgentStep 提供业务运行 ID、时间和状态。
- Controller -> Service -> Runtime -> LLM 的分层已形成。
- NDJSON 有开始、增量、终态事件。
- Prisma 中有 startedAt/endedAt，可计算粗粒度 duration。

### 缺口

- requestId 没有证据证明已写入 Run/Step 或结构化日志 context。
- Run 不记录 model、provider、usage、prompt/tool/context versions。
- 一个 `call_llm` step 无法区分多轮 sampling attempt。
- 没有 trace/span context 与异步 recovery link。
- 没有 metrics exporter/本地 metrics abstraction。
- 没有固定 eval dataset、runner、baseline 或 regression threshold。
- 研究基线显示仓库起初没有 `.spec/.test`；前序阶段应已补，但仍需在本阶段盘点覆盖缺口。
- 用户可见文案与内部 error code/diagnostic 尚未完全分开。

`x-request-id` 即使已存在也只标识一次 HTTP 请求：它不是身份凭证、不是 `clientRequestId` 幂等键、不是跨重连 Run ID，也不能单独证明一条异步执行链完整。

## 6. 五类证据

| 类型 | 例子 | 适合回答 | 不适合回答 |
| --- | --- | --- | --- |
| Durable Fact | Run/ToolResult/Approval | 当前真实状态、恢复 | 每个函数耗时 |
| Structured Log | error + IDs + code | 局部诊断、文本搜索 | 总体分位数 |
| Trace/Span | run->sampling->tool | 单次链路与因果耗时 | 业务质量本身 |
| Metric | success rate、p95 | 趋势、告警、容量 | 单条完整上下文 |
| Eval Result | case score/rubric | 质量与回归 | 实时系统故障 |

不要把完整 prompt/response 默认写日志来弥补 trace 设计不足。

## 7. Trace 关联模型

### 7.1 ID 层级

```text
requestId              一次 HTTP command/query/subscription
conversationId         长期业务会话
runId                  一次用户输入触发的执行
stepId                 durable execution step
samplingAttemptId      一轮 provider sampling
toolCallId             模型提出的一次调用
toolExecutionId        一次执行 attempt/idempotency unit
approvalId             一次待决策资源
recoveryAttemptId      一次恢复尝试
executionAttemptId     一次 worker 取得 lease 后推进 Run 的进程内执行区间
subscriberId           一次观察连接（仅 trace/log）
```

这些 ID 不是都作为 metric label。RunId 等高基数 ID 用于 trace/log/durable links，不用于常规时序指标标签。

### 7.2 Span 树/链接

```text
http.command [requestId]
  -- link --> agent.run.attempt [executionAttemptId=A1, runId]
                    context.build
                    model.sample [samplingAttemptId=1]
                    tool.policy
                    tool.execute [toolExecutionId]

http.approval-decision [new requestId]
  -- link --> agent.run.attempt [executionAttemptId=A2, same runId]

recovery.attempt [recoveryAttemptId]
  -- link --> agent.run.attempt [executionAttemptId=A3, same runId]
                    context.append_observation
                    model.sample [samplingAttemptId=2]
                    message.persist
                    run.finalize
```

异步 Run 可比 HTTP 请求、进程和 lease 活得更久。`agent.run` 是 durable 业务概念，不要求伪造一个跨数小时、跨进程永不结束的 root span。每次 worker 取得 lease 创建新的 `agent.run.attempt` span，用 `executionAttemptId/runId` 关联，并 link 到触发 command、approval decision、recovery attempt 和（若保留安全 trace reference）上一个 attempt。不要把新进程 span 设成已经结束的 HTTP span 的普通 child，也不要序列化 SDK Span 对象进数据库。

跨进程链路的权威关系来自 durable `RunExecutionAttempt(id, runId, leaseOwner, trigger, startedAt, endedAt, outcome, previousAttemptId?)`；traceId/spanId 只是可选诊断引用。Exporter 丢数据时，数据库仍能解释谁推进过 Run。

### 7.3 Durable wait duration

Approval/ManualReview 可能跨请求、跨进程等待，不能靠一个常驻 `approval.wait` span 的 wall clock 才能计算：

- Approval wait 使用 canonical `createdAt` 到 `decidedAt/expiredAt/canceledAt`。
- Manual review wait 使用 ReviewCase `createdAt` 到 `resolvedAt/abandonedAt`。
- 只有赢得终态 compare-and-set 的 handler 才在 commit 后尝试观察 duration，并携带 resource ID 供 trace/log 关联；trace span 只记录本次处理/恢复片段和 durable duration attribute。
- Metric delivery 仍可能因 crash 丢失或因 publisher retry 重复。若要求精确一次聚合，应从 durable terminal facts/outbox 幂等计算；exporter 失败绝不回滚 Approval decision。

## 8. Span 语义与字段

| Span | 建议属性（低敏） | 事件/错误 |
| --- | --- | --- |
| `agent.run.attempt` | executionAttemptId、status、model、promptVersion、trigger | lease/recovery/terminal code |
| `context.build` | estimatedTokens、sourceCounts、summaryUsed | exclusions/overBudget |
| `model.sample` | provider/model、attempt、input/output tokens | first_token、finishReason、retry |
| `tool.policy` | toolName、riskLevel、decision | reasonCode |
| `approval.wait.transition` | risk、outcome、durableWaitDuration | approve/reject/expire/cancel；不要求跨进程常驻 span |
| `tool.execute` | toolName、retrySafety、attempt、status | timeout/retry/errorCode |
| `recovery.attempt` | fromCheckpoint、action、outcome | manualReview |
| `stream.subscribe` | reconnect、afterSequence | disconnect/backpressure |

不记录：API Key、cookie、Authorization header、完整 prompt、完整 Tool arguments、完整用户正文。需要调试内容时使用显式 opt-in、脱敏、访问控制和短 retention。

## 9. Structured logging

建议每条重要日志使用稳定字段：

```json
{
  "event": "tool_execution_failed",
  "level": "error",
  "requestId": "...",
  "conversationId": "...",
  "runId": "...",
  "stepId": "...",
  "toolCallId": "...",
  "toolName": "publishSeoDraft",
  "errorCode": "TOOL_TIMEOUT",
  "retryable": true,
  "durationMs": 3210
}
```

日志 message 便于人读，`event/errorCode` 便于机器聚合。Error stack 只在服务端诊断，用户响应使用安全文案。

### 9.1 Request ID 的安全与语义限制

- incoming `x-request-id` 只接受受限字符和长度（例如 1-128 个可打印 ASCII/UUID 风格字符）；非法、超长或含换行的值丢弃并由服务端生成。
- response 可以回传规范化后的 ID，但它不授予任何权限，也不参与租户过滤。
- `requestId` 每个 command/query/subscription/reconnect/recovery trigger 都不同；跨请求关联使用 `runId/approvalId/executionAttemptId` 和 span links。
- 请求重放幂等使用 Phase 07 的 `clientRequestId + scope + fingerprint`，不能拿 requestId 代替。
- 不把任意客户端 requestId 原样写 metric label；日志/trace 也要先验证，避免 log injection 与超长 payload。

## 10. Metrics 设计

### 10.1 Run

- `agent_run_started_total{trigger,model_family}`
- `agent_run_completed_total{status,error_code}`
- `agent_run_duration_ms{status}` histogram
- `agent_run_sampling_count` histogram
- `agent_run_tool_call_count` histogram
- `agent_run_recovery_total{action,outcome}`

### 10.2 Model

- `model_request_total{provider,model_family,outcome}`
- `model_time_to_first_token_ms{provider,model_family}`
- `model_request_duration_ms{provider,model_family}`
- `model_input_tokens_total{provider,model_family}`
- `model_output_tokens_total{provider,model_family}`
- `model_retry_total{provider,reason}`

### 10.3 Tool/Approval

- `tool_execution_total{tool,outcome,error_code}`
- `tool_execution_duration_ms{tool,outcome}`
- `tool_retry_total{tool,reason}`
- `approval_request_total{tool,risk}`
- `approval_decision_total{outcome,risk}`
- `approval_wait_duration_ms{outcome}`

### 10.4 Context

- `context_estimated_tokens{model_family}`
- `context_actual_input_tokens{model_family}`
- `context_source_tokens{source_kind}`
- `context_truncation_total{source_kind,reason}`
- `context_compaction_total{outcome,trigger}`
- `context_compaction_duration_ms{outcome}`

### 10.5 Stream/Concurrency

- `run_active_conflict_total`
- `stream_disconnect_total{phase}`
- `stream_reconnect_total{outcome}`
- `stream_event_lag_ms`
- `stream_subscriber_dropped_total{reason}`
- `run_cancel_total{outcome}`

## 11. Metric label 规则

允许的典型低基数 label：status、outcome、provider、model family、tool name（受控 registry）、risk、error code、trigger。

禁止/慎用：runId、conversationId、requestId、userId、完整 URL、错误 message、Tool arguments、prompt version hash 数量无限增长的原值。

租户级成本确有需求时，应通过受控计费表/聚合任务，而不是直接把 tenantId 放入所有 Prometheus label。

“低基数”不是字段看起来短，而是**每个时间窗口内可能出现的 distinct series 有硬上限**。因此：

- `toolName` 只有来自受控、有限 registry 才可作为 label；动态 MCP/server tool 名需归一或进入 trace。
- `model` 应映射到受控 model family；把任意 provider deployment/version 原值作为 label 仍会增长。
- `error_code/reason` 必须来自稳定 allowlist；异常 message 绝不能当 label。
- prompt/tool schema/git SHA/version hash 即使单值很短，也会随部署无限增长，通常放 resource attribute、trace 或 eval manifest，不放高保留期指标。
- 为每个 metric 定义 label allowlist、每 label value budget 和组合 series budget；测试未知值归一为 `other/unknown` 或拒绝记录。

高基数 ID 可在有采样、访问控制和短 retention 的 trace/log 中用于单次定位，但这不等于“免费”；仍需控制 event 数量、索引与存储成本。

### 11.1 Telemetry 是 best-effort，数据库是权威

- span/log/metric exporter timeout、队列满或 backend 不可用不得让 Run、Approval、ToolResult 事务失败。
- 业务状态、恢复、审批是否完成、工具是否执行以 PostgreSQL canonical facts 为准；不能从“没看到 span/metric”推导“没发生”。
- 进程内 counters 可能因 crash 丢失或因重试重复，适合趋势/告警；计费、审计、exact report 从 durable facts/outbox 做幂等聚合。
- instrumentation 自身的失败应有有界、本地可观察信号，但不得递归制造无限日志。

## 12. Eval 数据集设计

### 12.1 先拆开三种 contract

不要把 scripted fake、评分规则和真实 provider config 混在一条 case 的 `modelFixtureOrConfig` 中。它们的生命周期、稳定性和 gate 完全不同：

```ts
interface RuntimeFixtureCase {
  id: string
  initialFacts: unknown
  userInput: string
  scriptedModelEvents: unknown[]
  fakeToolOutcomes: unknown[]
  expectedStateInvariants: string[]
}

interface SeoScoringCase {
  id: string
  category: string
  input: string
  referenceFacts?: unknown
  expected: {
    toolSequence?: string[]
    argumentAssertions?: unknown
    mustUseObservationFacts?: string[]
    mustNotClaim?: string[]
    answerRubric: string[]
  }
  tags: string[]
}

interface LiveModelEvalProfile {
  id: string
  provider: string
  model: string
  modelConfig: unknown
  repeats: number
  maxCases: number
  tokenAndCostBudget: unknown
}
```

- Runtime fixture suite 用 fake provider/tool + test DB，保护状态机、幂等、Approval、recovery，PR 必须确定性通过。
- Scorer suite 对一个标准 `RunTraceView + final answer` 评分；scorer 自己用已标注样本单独做 contract/calibration tests，不负责执行 runtime。
- Live model eval 用 profile 把同一 scoring dataset 绑定到具体 provider/model，记录随机性、成本和版本；它不能替代 runtime fixtures，也不把 provider config写回共享 case。

### 12.2 Scoring case schema

```ts
interface SeoScoringCase {
  id: string
  category: string
  input: string
  referenceFacts?: unknown
  expected: {
    toolSequence?: string[]
    argumentAssertions?: unknown
    mustUseObservationFacts?: string[]
    mustNotClaim?: string[]
    approvalOutcome?: string
    answerRubric: string[]
  }
  tags: string[]
}
```

### 12.3 最小分类

1. 不需工具的 SEO 解释。
2. 应调用只读检查工具。
3. 不应调用工具。
4. 参数抽取（URL、关键词、语言、市场）。
5. 使用 observation 回答，不能忽略工具结果。
6. 工具失败后诚实说明。
7. 写操作触发审批，批准前不执行。
8. 用户拒绝后不声称成功。
9. 长上下文/summary 保留关键约束。
10. 恢复/重连后最终答案与事实一致。
11. prompt injection/工具输出中的恶意指令不越权。
12. 成本/loop budget：不出现无界重复调用。

## 13. 评分分层

### Layer 1：确定性结构断言（硬门槛）

- tool sequence/name。
- callId/observation 配对。
- arguments schema/关键字段。
- approval 前 tool execution count=0。
- terminal statuses。
- must-not-call / must-not-claim。
- loop/sampling/tool budget。

这些失败不能被高质量文案分数抵消。

### Layer 2：业务 rubric

- 是否覆盖 title/description/keyword intent 等关键点。
- 是否引用真实 observation。
- 是否区分事实与建议。
- 是否给出可执行下一步。
- 是否遵守用户语言/格式要求。

### Layer 3：LLM judge（可选）

Judge 只用于难以 deterministic 判断的质量维度：

- judge prompt/version 固定。
- 隐藏 candidate identity，减少偏见。
- 保存理由但不当作绝对真理。
- 用一小组人工标注校准一致性。
- 安全/幂等硬门槛不能交给 judge。

## 14. Eval 可复现性

每次 eval result 记录：

- dataset version / case ID。
- application git SHA。
- model/provider/version 或 fixture ID。
- prompt version。
- tool schema/version。
- context policy/version。
- temperature/seed（provider 支持时）。
- actual tool trace、tokens、latency、cost estimate。
- scorer/judge version。
- runtime fixture version（仅 fixture suite）或 live eval profile ID（仅 live suite），不要在一个字段里混写。
- pass/fail 与分项分数。

真实模型仍有随机性。高风险结构行为用 fake provider/integration tests 确定性保护；质量 eval 可多次运行并报告分布。

## 15. Regression gate

建议分级：

### PR 快速 gate

- unit + contract + fake runtime suite。
- 10-20 条核心 deterministic eval。
- 所有安全/幂等 hard invariant 必须 100%。
- 耗时控制在团队可接受范围。

### Nightly/手动完整 gate

- 真实 provider eval dataset。
- 多次采样报告均值/方差。
- 成本和 latency budget。
- 与 baseline 比较，而非只看绝对分。

示例规则（需用实际 baseline 校准）：

- hard invariant：0 失败。
- tool selection accuracy：不得低于 baseline 超过容差。
- answer rubric average：不得显著下降。
- p95 sampling/tool count：不能异常上升。
- estimated cost per case：超过预算需人工批准。

## 16. 测试架构总图

| 层 | 保护内容 | 示例 |
| --- | --- | --- |
| Unit | 纯策略/mapper/reducer | tool policy、context normalizer、recovery planner |
| Integration/Fixture | Runtime + scripted fakes + DB | two-sampling tool loop、approval、crash recovery；不评分真实模型质量 |
| Contract | HTTP/NDJSON/provider adapter | DTO、event union、chunk mapping |
| Race/Recovery | 并发/kill/restart | lease、cancel/complete、reconnect |
| E2E | Vue -> API -> fake provider | confirmation/reload/stream |
| Scorer Contract | 标注输出 -> scorer | deterministic scorer、rubric/judge calibration |
| Live Eval | scoring dataset + profile + real model | 业务质量/工具选择分布；不替代状态机测试 |

Lint/typecheck 只保护静态质量，不能替代以上任何一层。

## 17. 从故障到回归用例

每个真实失败按流程处理：

1. 用 IDs 定位 trace 与 canonical facts。
2. 分类：protocol/state/tool/context/provider/UX/eval gap。
3. 最小化成 fixture。
4. 在最便宜的测试层增加失败用例。
5. 若涉及质量，加入 eval dataset 并更新版本。
6. 修复后记录 baseline 变化。

避免只加日志、不加回归测试。

## 18. 隐私、成本与 retention

- 默认 telemetry 不记录原文。
- 内容级 debug 必须 opt-in、脱敏、短期、受权限保护。
- trace/log/event/eval artifact 分别定义 retention。
- Eval dataset 不使用真实客户 secret/隐私页面；使用合成或授权样本。
- sampling/tool/compaction/judge 的 token/cost 分开归因。
- redaction 本身有自动化测试。

## 19. 任务拆解

### Task 09.1：Telemetry contract

- 定义 IDs、span names、attributes、error codes、redaction。
- 从 request middleware 贯穿 Run 创建。

### Task 09.2：核心 instrumentation

- instrument context/sampling/tool/approval/recovery/stream。
- 为每次跨进程 execution attempt 建独立 span + durable attempt link；wait duration 从 durable timestamps 计算。
- 先支持 local in-memory/test exporter，再接真实 backend。

### Task 09.3：Metrics 与 report

- 实现 counter/histogram。
- 高基数 validation。
- 生成本地 Markdown/JSON failure report 或最小 dashboard。

### Task 09.4：Runtime fixtures 与 SEO scoring dataset

- 分别建立 RuntimeFixtureCase 和 SeoScoringCase schema、10-20 个核心 cases。
- deterministic trace assertions 优先。
- 人工 rubric 小样本。

### Task 09.5：Scorer contract、Live profile 与 baseline

- scorer 对固定标注 artifact 单独测试；live runner 通过显式 profile 选择 real provider，不能用一个 fake/real 开关混同两类 suite。
- 固定版本 metadata。
- 输出 case diff、token/latency/cost。

### Task 09.6：Regression gate

- PR 快速套件。
- nightly/manual 完整套件。
- 失败有可读报告和 artifact。

### Task 09.7：故障演练与收口

- timeout、approval、crash、reconnect、context overrun 故障注入。
- 验证 trace 可以从 request 追到 terminal。
- 建立第一版 SLO/alert 假设，但不宣称生产成熟。

## 20. 明确非目标

- 不先购买/绑定某个 APM 厂商再设计语义。
- 不记录完整 chain-of-thought。
- 不把所有 prompt/response 默认写日志。
- 不用 LLM judge 代替安全与状态机断言。
- 不为了 dashboard 数量制造无意义 metrics。
- 不把 runId/userId 作为 Prometheus 高基数 label。
- 不在小数据集上宣称模型“全面提升”。
- 不把测试覆盖率百分比当唯一质量目标。

## 21. 退出标准

- [ ] 一次 Run 可通过 runId、executionAttemptId 和 span links 追到所有 sampling/tool/approval/recovery spans；任一 requestId 只定位它自己的请求入口。
- [ ] 每次跨进程 execution attempt 有独立 attemptId/span/durable record；command/subscriber/recovery 使用正确 link/业务关联，不伪造父子时长。
- [ ] approval/manual-review wait duration 可从 durable timestamps 重算，进程重启不丢失。
- [ ] token、TTFT、总耗时、tool duration、approval wait、compaction/recovery 可度量。
- [ ] metric labels 通过低基数检查。
- [ ] requestId 已限制格式/长度且未被当作 auth/idempotency/run identity；telemetry failure 不影响 canonical transaction。
- [ ] telemetry redaction tests 证明 secret/原文默认不输出。
- [ ] 至少 10-20 条版本化 SEO eval cases。
- [ ] hard invariant 与业务质量分层评分。
- [ ] prompt/model/tool/context/scorer versions 写入 eval result。
- [ ] 一条命令生成机器可读结果和人类可读失败报告。
- [ ] baseline comparison 与 regression threshold 已定义。
- [ ] 至少一次真实故障可从 trace 定位并沉淀成回归用例。
- [ ] unit/integration/contract/recovery/e2e/eval 各层边界清楚。
- [ ] runtime fixture、scorer contract、live model eval profile 三套 artifact/runner/gate 已拆开。

## 22. 阶段产物

- Telemetry semantic convention 文档/类型。
- 结构化 logger + trace/metric ports 与 test exporter。
- 核心 Run span tree 和指标。
- redaction/retention policy。
- SEO eval dataset、runner、scorers、baseline。
- PR/nightly regression gate。
- failure report/dashboard 与复盘样例。

## 23. 阶段复盘

1. 哪个指标能发现 Tool loop 意外多采样？
2. 哪个 trace 能解释 TTFT 变慢是 context、provider 还是 queue？
3. 为什么 final answer 看起来不错仍可能 hard invariant fail？
4. 当前 eval 哪些结论受模型随机性影响？
5. 哪些 telemetry 字段最容易泄漏用户内容？
6. 下一次 prompt/model 升级必须经过哪些 gate？
