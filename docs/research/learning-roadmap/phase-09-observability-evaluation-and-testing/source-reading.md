# Phase 09 源码阅读：Trace、Metrics 与测试如何保护 Runtime

## 1. 阅读问题

> Codex 如何把 inference、tool dispatch、compaction、持久化和 protocol event 关联成可诊断证据？它的测试为何不仅覆盖 happy path？

本阶段不要求通读整个 OpenTelemetry crate。先读语义、边界和测试，再决定当前 TypeScript 项目用什么库落地。

## 2. 总体阅读地图

| 主题 | Codex 源码 |
| --- | --- |
| 基础 OTel/metrics | `codex-rs/otel/` |
| Runtime sampling spans | `codex-rs/core/src/session/turn.rs` |
| Tool dispatch trace | `codex-rs/core/src/tools/tool_dispatch_trace.rs` |
| MCP tool telemetry | `codex-rs/core/src/mcp_tool_call/telemetry.rs` |
| Rollout persistence metrics | `codex-rs/rollout/src/persistence_metrics.rs` |
| Rollout trace model/reducers | `codex-rs/rollout-trace/` |
| App/exec telemetry | `codex-rs/cli/src/exec_server_telemetry.rs`、`exec-server/src/telemetry.rs` |

## 3. 第一条链：Sampling trace

在 `codex-rs/core/src/session/turn.rs` 中搜索：

```sh
rg -n "trace_span|instrument|inference_trace|stream_request|receiving_stream" \
  /Users/ayu/Desktop/codex/codex-rs/core/src/session/turn.rs
```

重点位置：

- `run_turn` 准备 sampling input 的 span。
- `try_run_sampling_request` 附近 inference trace context。
- `stream_request`。
- receiving/response handling spans。

阅读问题：

1. 构建输入、发送请求、接收 stream 为什么分 span？
2. inference trace 如何与 Thread/Turn 关联？
3. provider stream 的 first response/complete/error 在哪里记录？
4. retry 是否创建新 attempt/span？
5. 哪些 attributes 是模型/配置，哪些不应包含原文？

当前项目应将 `call_llm` 从单个粗 Step 细化为每轮 `samplingAttemptId` 的 trace/span；durable Step 是否也细化取决于恢复/查询需要，不要求 span=数据库行。

同时不要假装一个进程内 span 能跨 worker restart 存活。当前项目应为每次 lease ownership 建 `executionAttemptId + agent.run.attempt span`，新进程通过 runId、durable previousAttemptId 和 span link 关联旧 attempt；旧 span 已结束或丢失都不影响 RecoveryPlanner。

## 4. 第二条链：Tool dispatch trace

阅读：

- `codex-rs/core/src/tools/tool_dispatch_trace.rs`
- `codex-rs/core/src/tools/tool_dispatch_trace_tests.rs`
- `codex-rs/core/src/mcp_tool_call/telemetry.rs`
- `codex-rs/core/src/mcp_tool_call/telemetry_tests.rs`

观察：

- tool name/call origin/outcome 如何表达。
- success/error/cancel 是否有稳定状态。
- duration 在哪个边界开始/结束。
- trace field 如何通过 tests 验证。
- tool arguments 是否默认进入 telemetry。

翻译到当前项目：`toolCallId` 和 `toolExecutionId` 是高基数关联字段，适合 span/log，不适合 metric label；toolName 来自受控 registry，可作为低基数 label。

## 5. 第三条链：OTel/Metric 基础设施

### 5.1 先读文档与接口

- `codex-rs/otel/README.md`
- `codex-rs/otel/src/lib.rs`
- `codex-rs/otel/src/provider.rs`
- `codex-rs/otel/src/trace_context.rs`

理解：

- provider/exporter 与业务 instrumentation 分开。
- trace context 的传播和解析。
- exporter 关闭/失败不应破坏 Agent 业务。

### 5.2 Metrics

- `codex-rs/otel/src/metrics/names.rs`
- `codex-rs/otel/src/metrics/tags.rs`
- `codex-rs/otel/src/metrics/validation.rs`
- `codex-rs/otel/src/metrics/timer.rs`
- `codex-rs/otel/tests/suite/validation.rs`
- `codex-rs/otel/tests/suite/timing.rs`

阅读问题：

1. metric name/tag 为什么集中定义和校验？
2. timer 如何保证 success/error 路径都记录？
3. exporter/test harness 如何验证数据而非看日志？
4. 高基数或非法 tag 如何阻止？

当前项目不必复制 crate 结构；需要相同理念：业务依赖小的 telemetry port，测试用 in-memory exporter 捕获 span/metric。

这些 port 是 best-effort：exporter/backend 失败不能回滚 Run/Approval/ToolResult 的 canonical transaction。若需要计费/审计精确值，应从数据库 facts/outbox 幂等聚合，不能把进程内 metric 当权威账本。

## 6. 第四条链：Rollout trace 与 reducer

按顺序选读：

- `codex-rs/rollout-trace/README.md`
- `codex-rs/rollout-trace/src/model/runtime.rs`
- `codex-rs/rollout-trace/src/model/conversation.rs`
- `codex-rs/rollout-trace/src/inference.rs`
- `codex-rs/rollout-trace/src/tool_dispatch.rs`
- `codex-rs/rollout-trace/src/protocol_event.rs`
- `codex-rs/rollout-trace/src/reducer/inference.rs`
- `codex-rs/rollout-trace/src/reducer/tool.rs`
- 对应 `*_tests.rs`

重点不是复制格式，而是理解：

- raw events 如何 reducer 成可分析模型。
- protocol/runtime/tool/inference 事件如何用 ID/顺序关联。
- reducer 对缺失、重复、乱序数据有哪些 normalization。
- 测试如何用 fixture/snapshot 锁定 trace 语义。

这能启发当前项目的本地 eval/report：从 Run facts + captured events 生成 `RunTraceView`，而不是靠人工翻日志。

## 7. 第五条链：持久化 metrics

阅读：

- `codex-rs/rollout/src/persistence_metrics.rs`
- `codex-rs/rollout/src/persistence_metrics_tests.rs`

观察 filter 前/后的 item count/bytes。迁移问题：

- 当前 Step input/output 和 event payload 各占多少？
- Tool output truncation 前后大小如何度量？
- 如果 durable event replay 开启，retention/bytes 如何监控？
- metrics 本身失败是否影响持久化？答案应为否。

## 8. Codex 测试如何当架构文档

不要只看 `otel/`。从前序阶段源码地图选择：

| 行为 | 测试证据 |
| --- | --- |
| Tool router/registry | `core/src/tools/router_tests.rs`、`registry_tests.rs` |
| Context normalization | `core/src/context_manager/history_tests.rs` |
| Compaction | `core/src/compact_tests.rs`、app-server `compaction.rs` |
| Interrupt | app-server `turn_interrupt.rs` |
| Resume | app-server `thread_resume.rs` |
| Approval | `sandboxing_tests.rs`、turn start/resume cases |
| Protocol contract | app-server v2 suite |
| SDK stream/abort | TypeScript SDK tests |

每读一个测试，记录它属于 unit/integration/contract/recovery/e2e 哪层，以及为何最便宜的层能/不能保护这个不变量。

## 9. 当前项目反向阅读

### 9.1 Request ID

阅读：

- `apps/api/src/common/middleware/request-id.middleware.ts`
- `apps/api/src/common/utils/http-request.util.ts`
- `apps/api/src/common/bootstrap/register-app-globals.ts`

确认：

- incoming `x-request-id` 是否信任任意长度/格式？
- 是否拒绝/替换换行、控制字符、超长值，防止 log/header injection？
- response 是否回传 ID？
- requestId 如何进入 service/runtime，目前是否只停在 request object？
- 异步 Run 继续后如何保留 trigger request ID，同时为 recovery 建新 attempt ID？
- 是否明确 requestId 不是 auth、clientRequestId 幂等键或跨请求 Run identity？

### 9.2 Run/Step timing

阅读 `agent-run-recorder.service.ts` 与 schema：

- startedAt/endedAt 能计算哪些 duration？
- 多次 sampling/tool attempt 是否被同一步覆盖？
- `completeRun()` 发现 unfinished step 只写 logger warn；是否应形成 metric/test failure？
- errorMessage 是否有 stable code？
- logger 是否结构化携带 runId/stepId？
- approval/manual review wait duration 是否能用 durable createdAt/terminalAt 跨进程重算，而不是依赖一个常驻 span？

### 9.3 Provider usage

阅读：

- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/llm/clients/openai-compatible.client.ts`

确认 provider adapter 当前是否保留 usage、finish reason、request ID、TTFT。若 Phase 01 已升级，以实际代码为准重新核对。

### 9.4 Stream/Frontend

阅读 mapper/parser/composable，列出可测指标：

- command latency。
- start/first delta/terminal 时间。
- disconnect phase。
- reconnect attempt/outcome。
- parser invalid/early EOF。
- local optimistic 与 canonical reconciliation 冲突。

### 9.5 测试盘点

```sh
rg --files /Users/ayu/Desktop/agent \
  | rg '(spec|test)\.(ts|tsx|js)$|vitest|jest|playwright'
```

按测试层盘点，不以文件数量为结论：

- 哪些纯函数没有 unit tests？
- Tool loop/approval/context/recovery/race 是否有 integration tests？
- NDJSON/shared contract 是否有 contract tests？
- Vue reload/reconnect 是否有 component/E2E tests？
- SEO quality 是否有 fixed eval cases？

## 10. 当前项目 telemetry 设计练习

沿一次 tool+approval Run 标注：

```text
HTTP command(requestId)
  -> create Run(runId)
  -> context.build
  -> sampling(attemptId=1)
  -> tool.policy(callId)
  -> approval resource wait(approvalId, durable timestamps；不要求常驻 span)
  -> decision(new requestId)
  -> tool.execute(executionId)
  -> sampling(attemptId=2)
  -> persist final Message
  -> terminal
  -> reconnect subscriber(another requestId)
```

为每个节点写：span name、business IDs、metric、durable fact、敏感字段、测试。

## 11. Eval 反向取材

从项目真实产品目标构造 cases，阅读：

- `apps/api/src/seo/prompts/seo-agent.prompt.ts`
- 现有 SEO DTO/contracts。
- 当前/后续 Tool definitions。
- `docs/tasks/` 中已实现的验收场景。

不要从通用 chatbot benchmark 起步。每个 case 应对应当前 SEO Agent 的可见能力和失败风险，并先拆成三份：

1. `RuntimeFixtureCase`：scripted provider/tool/DB facts，保护确定性状态机。
2. `SeoScoringCase` + scorer contract artifacts：对标准 RunTraceView/final answer 评分，不启动 runtime。
3. `LiveModelEvalProfile`：provider/model/repeats/cost budget，绑定 scoring dataset 做随机性实验。

不能在同一个 `modelFixtureOrConfig` 字段里用开关区分 fake/real；那会让 PR fixture、scorer 校准和真实模型质量的失败边界混在一起。

## 12. 推荐阅读顺序

1. 当前 request ID / Run/Step / provider boundary。
2. `turn.rs` sampling spans。
3. `tool_dispatch_trace.rs` + tests。
4. `otel` README、metric names/tags/validation tests。
5. `rollout-trace` model/reducer 一条链。
6. rollout persistence metrics。
7. Codex 前序关键行为测试。
8. 当前测试盘点与 eval case 取材。

## 13. 必答问题

### Codex 侧

1. sampling 为什么拆 input build、stream request、receiving spans？
2. tool trace 如何表达 call/outcome，而不依赖完整 arguments？
3. metric tag validation 防什么问题？
4. rollout trace reducer 与 raw events 为什么分开？
5. 测试如何比注释更准确表达 resume/compaction/approval 约束？

### 当前项目侧

1. requestId 目前走到哪一层就丢了？
2. recovery request 与原 command 应使用 parent、link 还是仅业务 ID？
3. 哪些 ID 绝不能做 metric label？
   还要解释为什么动态 tool name、model deployment、prompt hash 即使字符串很短也可能造成高基数。
4. TTFT 如何从当前 stream 事件测量？
5. 两轮 sampling 如何分别记录 usage？
6. 哪些 10-20 条 SEO cases 最能暴露当前产品风险？
7. 哪些断言必须 deterministic，不能交给 LLM judge？
8. 新 worker 如何用独立 executionAttempt span/link 接续同一 durable Run？
9. telemetry exporter 丢数据时，哪些结论只能回到 PostgreSQL canonical facts 判断？

## 14. 可跳过内容

- 所有 OTLP exporter/network 细节。
- Codex Cloud 特有 telemetry backend。
- rollout trace 中 code cell/multi-agent 全部 reducer。
- 各平台 process metrics。
- 与 SEO Agent 无关的 guardian/memories metrics。

## 15. 阅读完成证据

- [ ] 画出一条完整 Run span tree 和异步 links。
- [ ] 建立 ID 字典与 metric label allow/deny 表。
- [ ] 为 requestId 写长度/字符/语义限制，并为动态 label 写 cardinality budget。
- [ ] 画出跨进程 execution attempts/links 与 durable approval/manual-review wait duration。
- [ ] 找到 sampling/tool/persistence 三类 telemetry 源码和测试。
- [ ] 按测试层完成当前仓库覆盖盘点。
- [ ] 提出 10-20 条 SEO eval case 标题与分类。
- [ ] 定义 hard invariant 与 quality rubric 的边界。
- [ ] 分开 RuntimeFixtureCase、scorer contract artifacts 与 LiveModelEvalProfile。
- [ ] 写出默认不记录的敏感字段清单。
