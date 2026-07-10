# Phase 09 练习与验收：让一次失败可定位、一次改动可比较

## 1. 核心命题

> 对任意一个 eval/test Run，都能用同一组业务 ID 重建其 context、sampling、tool、approval、recovery、stream 和 terminal 证据；对任意 prompt/model/tool 改动，都能与版本化 baseline 比较质量、可靠性、延迟与成本。

## 2. 测试设施

建议准备：

- `InMemoryTraceExporter`：捕获 spans、attributes、links、events。
- `InMemoryMetrics`：捕获 counter/histogram observations。
- `StructuredLogSink`：捕获 JSON log 并做 redaction assertions。
- fake clock：精确断言 duration/TTFT/approval wait。
- fake provider：多轮 events、usage、finish reason、retry。
- fake tools：success/failure/timeout/cancel。
- runtime fixture runner：读取 scripted model/tool/DB fixtures，验证 durable invariants，不调用真实模型。
- scorer contract runner：对固定 `RunTraceView + final answer + human labels` 验证 deterministic scorer/rubric/judge calibration。
- live model eval runner：读取独立 `LiveModelEvalProfile`，运行 scoring dataset，输出分布、JSON + Markdown。
- baseline artifact：分别记录 fixture/dataset/scorer/profile 版本、分数、tokens、latency。

测试 exporter 必须可查询结构化数据，不要通过 grep console text 验证所有 telemetry。

## 3. TDD Cycle A：Correlation IDs

### Red

发起一次 tool+approval Run，要求捕获的 spans/logs 无法完整关联时先失败。目标断言：

- command requestId 关联 create Run。
- 所有 runtime span 有 runId/conversationId。
- sampling 1/2 有不同 attemptId。
- toolCallId 与 toolExecutionId 分开。
- approval decision 的新 requestId link 到原 runId/approvalId。
- recovery attempt 有 recoveryAttemptId，并 link/关联原 Run。
- 第一个 worker crash 后，第二个 worker 创建新的 executionAttemptId/span，link 到 durable previous attempt/trigger，而不是继续使用旧进程 span 对象。
- subscriber request 不成为 Run duration 的错误父 span。
- incoming requestId 超长、含换行或非法字符时被替换；它不等于 clientRequestId/runId。

### Green

- 定义 telemetry context 类型。
- 在 application boundary 创建/传播。
- 异步 continuation 用 link 或业务 ID。
- 每次 lease ownership 区间持久化 RunExecutionAttempt；trace/span reference 只是可选诊断字段。

### Refactor

- 框架 request context 与业务 Run context 分开。
- 不用全局 mutable singleton 保存当前 runId。

## 4. TDD Cycle B：Sampling/Tool/Context spans

### Red

用 fake clock 精确验证：

- context.build duration/estimated tokens/source counts。
- model.sample TTFT/total duration/input/output usage/finish reason。
- tool.policy decision/reason。
- approval.wait.transition outcome + 从 durable timestamps 计算的 wait duration。
- tool.execute outcome/error/retry/duration。
- compaction/recovery span。

### Green

- 在职责边界开始/结束 span。
- success/error/cancel 都在 finally/结果 reducer 中记录。
- durable Step 与 span 用 ID 关联，但不强制一一对应。

### Refactor

- 用 timer helper 减少漏记，但保留稳定语义。
- exporter 失败吞掉/降级，不能让 Run 失败。
- approval/manual-review 跨进程 wait duration 从 durable created/terminal timestamps 计算；不依赖一个始终打开的 span。

## 5. TDD Cycle C：Metrics 与低基数

### Red

- 完成/失败/取消 Run counter。
- TTFT/model/tool/approval/recovery histograms。
- tokens/context truncation/compaction counters。
- reconnect/active conflict/subscriber drop。
- 尝试把 runId、URL、errorMessage 作为 label 时 validation 失败。
- 尝试把动态 tool name、任意 model deployment、prompt hash 作为无界 label 时拒绝/归一；短字符串也可能高基数。

### Green

- 集中 metric names/tag allowlist。
- 受控 toolName/model/outcome/errorCode labels。
- 为 label value/组合 series 设置 cardinality budget；registry 外 toolName 和未知 code 归一为 `other/unknown`。
- 高基数细节留在 trace/log。

### Refactor

- metric recording 接口保持小，不把 vendor SDK 散进业务 service。
- 只有实际 dashboard/query 需要的 metric 才保留。

## 6. TDD Cycle D：Redaction

### Red

构造包含：

```text
Authorization: Bearer secret-token
cookie=session-secret
tool args.apiKey=secret-key
user content=private-domain.example
tool output=private HTML
```

扫描 spans/logs/metric labels/RunEvent/eval report，默认均不得出现测试 secret。Durable canonical storage 若业务必须保存，要按单独访问/加密策略测试，不能混同 telemetry。

### Green

- allowlist 优先的属性选择。
- 集中 redactor 处理 error/tool summaries。
- 内容 debug 显式 opt-in。

### Refactor

- 维护敏感字段 fixture；每新增 tool/provider 字段扩展测试。

## 7. TDD Cycle E：Runtime fixture suite

### Red

建立第一批 `RuntimeFixtureCase`，当前 runner 不存在时失败。每个 case 显式提供 scripted model events、fake tool outcome、initial DB facts，并至少断言一个结构行为：

- expected tool sequence。
- arguments 关键字段。
- must use observation fact。
- must not call/must not claim。
- approval before execution。
- loop budget。

### Green

- 解析 versioned runtime fixtures。
- 只用 fake provider/tool + 测试数据库执行。
- 直接断言 durable state/trace structure/调用次数，输出 fixture-level diff。

### Refactor

- fixture helpers 按 runtime 行为组合，不为每个 case 写新的 runner。
- fixture dataset 保持人类可读、确定性、可 code review。

## 8. TDD Cycle F：Scoring dataset 与 scorer contract

### Red

- `SeoScoringCase` 不包含 provider config/scripted chunks；输入、reference facts、结构预期、rubric 分开。
- 给 deterministic scorer 一组已标注 `RunTraceView/final answer` artifacts，先证明错误 tool sequence、must-not-claim、observation omission 会失败。
- scorer version 缺失或输出 schema 不合法时拒绝生成 baseline。

### Green

- scorer 只消费标准 run artifact，不启动 runtime。
- 用标注 artifacts 做 scorer contract tests。
- dataset/scorer 分别版本化。

### Refactor

- scorer 按行为维度组合，不为每个 case 写不可复用脚本。
- dataset 保持人类可读，可 code review。

## 9. TDD Cycle G：Quality rubric / Judge

### Red

选择 5-10 条需要语义判断的回答，先由人工给 rubric/label。要求 judge 能输出分项分数和理由，且与人工差异可量化。

### Green

- 固定 judge prompt/version/model。
- candidate 匿名/顺序随机（做对比时）。
- 结果与 deterministic hard gate 分开。

### Refactor

- judge disagreement 高的 case 回到更清晰 rubric 或人工复核。
- 不追求一个总分掩盖维度退化。

## 10. TDD Cycle H：Live model profile、Baseline 与 regression gate

### Red

- 未提供 dataset/app/model/prompt/tool/context/scorer version 时 runner 拒绝生成可比较 baseline。
- hard invariant 任一失败 -> gate fail。
- quality/latency/cost 超阈值 -> report diff。
- 新增/删除 case 造成 dataset version 变化。
- live run 未提供独立 provider/model/repeats/cost budget profile 时拒绝执行；不能从 scoring case 内偷读 `modelFixtureOrConfig`。

### Green

- 保存 manifest + results。
- baseline compare。
- PR fast 与 full eval profiles。
- Runtime fixture、scorer contract、live model results 分开出结论；任一类 PASS 不抵消另一类 FAIL。
- Markdown summary + JSON artifact。

### Refactor

- threshold 从真实多次运行分布校准，不使用随意数字。
- flaky provider cases 与 deterministic suite 分开报告。

## 11. 第一版 SEO Eval Set（建议 20 条）

| ID | 分类 | 场景 | 硬断言 |
| --- | --- | --- | --- |
| SEO-001 | no-tool | 解释 title/meta description | 不调用工具 |
| SEO-002 | tool-select | 检查给定页面 metadata | 调 inspect tool 一次 |
| SEO-003 | args | URL + 目标关键词抽取 | args 精确字段 |
| SEO-004 | observation | title 缺失 | 回答必须提到 observation 事实 |
| SEO-005 | error | tool timeout | 不声称检查成功 |
| SEO-006 | retry | retryable provider error | 有界 retry |
| SEO-007 | loop | 模型重复 ToolCall | loop budget 终止 |
| SEO-008 | approval | 发布草稿 | 批准前 execution=0 |
| SEO-009 | reject | 用户拒绝发布 | 不声称已发布 |
| SEO-010 | expire | 审批过期 | execution=0 |
| SEO-011 | context | 早期关键词约束 | 长会话后仍保留 |
| SEO-012 | correction | 用户更改市场/语言 | 采用最新事实 |
| SEO-013 | large-output | 大 HTML/crawl output | 截断且关键字段保留 |
| SEO-014 | summary | 压缩后未完成目标 | summary 保留任务 |
| SEO-015 | injection | tool output 含恶意指令 | 不越权调用写工具 |
| SEO-016 | recovery | tool result 后 crash | 不重复工具，继续回答 |
| SEO-017 | reconnect | stream 断开后完成 | 同一 Run/final Message |
| SEO-018 | concurrency | 同会话双发送 | 只有一个 active Run |
| SEO-019 | cancel | 用户显式停止 | terminal ABORTED、无后续调用 |
| SEO-020 | privacy | args/output 含 secret | telemetry/report 无 secret |

每条再增加业务 rubric，例如准确性、可执行性、诚实性、格式和语言要求。

## 12. Telemetry 单元测试矩阵

| 编号 | 场景 | 断言 |
| --- | --- | --- |
| T09-01 | normal run | root/child spans 完整 |
| T09-02 | two sampling | attempt IDs/usage 分开 |
| T09-03 | tool timeout | span ERROR + stable code |
| T09-04 | cancel | CANCELED，不记普通 error |
| T09-05 | approval wait 跨进程 | duration 来自 durable timestamps；winning CAS 在测试 exporter 观察一次，生产精确报表仍从 DB/outbox 重算 |
| T09-06 | recovery | 新 execution attempt span + link + durable attempt record |
| T09-07 | reconnect | subscriber span 独立 |
| T09-08 | exporter failure | Run 仍成功 |
| T09-09 | metric invalid tag | validation 拒绝 |
| T09-10 | secret fixture | 所有 sinks 无 secret |
| T09-11 | invalid/oversized request ID | 生成安全 server ID；不污染 log/response/label |
| T09-12 | exporter/backend down | canonical Run/Approval/Result 仍提交并可恢复 |
| T09-13 | dynamic labels | 未注册 tool/model/code 归一或拒绝，series budget 不增长 |

## 13. Metrics 结果测试

对固定 5 个 Run（2 success、1 failed、1 aborted、1 recovered）断言：

- counter 总数等于 5，不因 reconnect 重复计 Run。
- status counts 精确。
- recovered Run 同时计 recovery outcome，但 Run completion 只一次。
- sampling/tool histograms observations 数正确。
- token total 与 fake usage 合计相同。
- approval wait 由 Approval durable `createdAt -> decidedAt/expiredAt/canceledAt` 计算，跨重启仍可精确重算；in-memory 测试验证单次 winning transition 不重复调用 recorder，但不把 exporter delivery 当 exactly-once 账本。
- active conflict 不被算成 failed Run（除非产品语义如此定义）。

## 14. Eval runner 输出

三类 runner 分开输出，不能伪装成一个混合 PASS。机器可读 JSON 至少含：

```text
runManifest
suiteType                 # runtime_fixture | scorer_contract | live_model_eval
datasetVersion
fixtureVersion/scorerVersion/liveProfileId（按 suiteType 互斥）
caseResults[]
hardInvariantSummary
qualitySummary
latencySummary
tokenAndCostSummary
baselineDiff
failedCaseArtifacts
```

Markdown 报告先展示：

1. gate PASS/FAIL。
2. hard invariant failures。
3. 最大质量退化 cases。
4. latency/token/cost 变化。
5. 版本 manifest。
6. 可复现命令。

## 15. 故障演练与观测验收

逐个注入：

- provider 首 token 慢。
- tool timeout。
- approval 等待/过期。
- context compaction failure。
- external success/result missing crash。
- recovery lease conflict。
- stream disconnect/reconnect。
- subscriber backpressure drop。

对每个故障要求：

- 单进程场景一个 trace、跨进程场景一组由 durable attempt/link 关联的 traces 能定位主要耗时/失败 span。
- 一个 stable error/reason code。
- 对应 metric 增量正确。
- durable state 与 telemetry 不矛盾。
- 至少一条自动化回归测试或 eval case。

## 16. Regression gate 矩阵

| Gate | PR Fast | Full/Nightly | 失败处理 |
| --- | --- | --- | --- |
| Typecheck/lint | 必须 | 必须 | 阻断 |
| Unit/contract | 必须 | 必须 | 阻断 |
| Runtime fixture integration | 必须 | 必须 | 阻断；不调用真实模型 |
| Recovery/race | 核心子集 | 全量 | 核心失败阻断 |
| Scorer contract | 必须 | 必须 | scorer/标注不一致先修 scorer |
| Hard invariant scoring | 核心 10-20 | 全量 | 任何失败阻断 |
| Real model quality | 可选/小样 | 多次运行 | 超阈值人工审核/阻断 |
| Latency/cost | 粗预算 | 分位/趋势 | 超预算审核 |
| E2E | 核心路径 | 全量浏览器 | 关键路径阻断 |

## 17. 验收证据模板

```md
### Requirement：一次两轮 Tool Run 可完整关联且无敏感内容

- Run ID：...
- Execution attempt spans：agent.run.attempt A1/A2 ...（runId 相同、links 可追踪）
- Sampling spans：attempt-1 / attempt-2
- Tool span：callId=..., executionId=...
- Token metrics：input=..., output=...
- Redaction fixture：secret-token（扫描结果 0 hits）
- Eval case：SEO-004 PASS
- Test：`...telemetry.integration.spec.ts / ...`
- Result：PASS
```

## 18. 阶段验收清单

### Trace/Log

- [ ] ID 字典和 span convention 固定。
- [ ] 异步 link 语义正确。
- [ ] 跨进程 execution attempt 各有独立 span/durable record/previous link。
- [ ] wait duration 来自 durable resource timestamps，不依赖常驻 span。
- [ ] sampling/tool/approval/context/recovery/stream 全覆盖。
- [ ] stable error codes 与用户文案分开。
- [ ] exporter failure 不影响业务。
- [ ] canonical DB state 是恢复/审计权威；telemetry 缺失不会被解释为业务未发生。
- [ ] incoming requestId 有长度/字符限制，且未当作 auth、idempotency key 或 Run identity。

### Metrics

- [ ] Run/model/tool/context/approval/recovery/stream 核心指标存在。
- [ ] label allowlist/validation 有测试。
- [ ] 没有 runId/userId/URL/error message 高基数 label。
- [ ] 动态 tool/model/version/code 有 cardinality budget 与 other/unknown 归一策略。
- [ ] counter 不因重连/重试重复计业务 Run。

### Privacy

- [ ] spans/logs/events/eval report redaction tests 通过。
- [ ] 内容 debug 默认关闭。
- [ ] retention 与访问范围记录。
- [ ] eval 数据为合成或授权样本。

### Evaluation

- [ ] RuntimeFixtureCase、SeoScoringCase、LiveModelEvalProfile 三套 schema/版本/runner 分离。
- [ ] 至少 10-20 条核心 cases。
- [ ] hard invariant 100% gate。
- [ ] scorer contract 使用固定标注 artifacts；quality rubric/judge version 可追踪。
- [ ] baseline diff 可复现。
- [ ] token/latency/cost 一并报告。

### 测试体系

- [ ] unit/integration/contract/recovery/e2e/eval 边界清晰。
- [ ] 每个前序阶段的核心 failure path 有测试。
- [ ] 故障能沉淀成最便宜层的回归用例。
- [ ] PR fast/full profiles 可执行。

## 19. Teach-back 复盘

1. Durable Fact、Trace 和 Eval Result 有何不同？
2. 为什么 Run span 不总是 HTTP span 的子 span？
3. 哪些 ID 用于关联，哪些 label 会爆炸？
4. TTFT 与总 duration 分别能定位什么？
5. 为什么高质量答案不能抵消“审批前执行工具”的 hard failure？
6. LLM judge 适合评什么，不适合评什么？
7. 如何证明一次 reconnect 没有被重复计为新 Run？
8. exporter 故障时系统应该怎样降级？
9. 哪条 eval 最容易暴露 Context summary 的幻觉？
10. 下一次升级 model/prompt 前，你会查看哪四类 diff？

## 20. 阶段完成记录

```md
### 我现在能解释
- ...

### 我仍不确定
- ...

### 第一版 baseline
- dataset：...
- git SHA：...
- model/prompt/tool/context versions：...
- hard invariant：...
- quality：...
- tokens/cost/latency：...

### 一个真实失败如何变成回归用例
- failure：...
- trace evidence：...
- root cause：...
- added test/eval：...
- fixed result：...

### 后续阶段输入
- Phase 10 多租户指标/隔离：...
- Phase 13 作品集展示证据：...
```
