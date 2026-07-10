# Phase 04 实践与验收：让 Tool Loop 在失败时也可信

## 1. 实践目标

把 Phase 03 的黄金路径升级为可审计状态机：每轮 sampling、每次 tool execution 有独立 step；timeout、abort、invalid args、oversized output、budget exceeded 都能有限收口；数据库不泄漏 secret 或保存无界 payload。

## 2. 前置条件

- Phase 03 全矩阵已通过并保留 captured second request。
- Prisma 变更若发生，已有迁移与隔离测试策略。
- 已决定 AgentStep 只记录执行事实，不记录 chain-of-thought。
- 已读 [README.md](./README.md) 和 [source-reading.md](./source-reading.md)。

## 3. 实践设计：动态 Step 状态机

### 3.1 状态图

```text
create/start -> RUNNING
RUNNING -> COMPLETED
RUNNING -> FAILED
RUNNING -> ABORTED
```

如果选择先创建 PENDING，则允许 `PENDING -> RUNNING/ABORTED`，但本阶段不再批量预创建未知数量的 sampling/tool steps。

终态不可再次转换。Recorder update 应带当前 status 条件并检查 affected row count，避免 race 静默成功。

### 3.2 Golden run 的预期 steps

| sequence | type | status | 关键 output |
| ---: | --- | --- | --- |
| 1 | receive_user_message | COMPLETED | messageId/length |
| 2 | load_conversation_history | COMPLETED | count |
| 3 | model_sampling | COMPLETED | index=1, finish=tool_calls |
| 4 | tool_execution | COMPLETED | callId/name/duration/result summary |
| 5 | model_sampling | COMPLETED | index=2, finish=stop |
| 6 | assistant_output | COMPLETED | contentLength |

sequence 具体起点不重要，单调、唯一、可重建才重要。

## 4. Red-Green-Refactor

### Exercise 04-A：重复 step identity

**Red**：创建两个 `model_sampling`，分别 complete；用现有 updateMany 会无法单独更新或根本没有第二条。

**Green**：`startStep()` 返回 id，complete/fail/abort 只按 id + current status 更新。

**Refactor**：用 transaction/helper 统一 terminal transition；affected count != 1 时抛 invariant error。

### Exercise 04-B：Tool timeout

**Red**：fake executor 永不 resolve，测试超时挂死。

**Green**：execution signal 在小 deadline 后触发，result code=timeout，tool step FAILED，run 按策略结束或生成失败 observation。

**Green 的强条件**：fake executor 必须故意完全忽略 signal 且永不 settle；orchestrator 用主动 `Promise.race` 在 deadline 内返回。仅验证“合作型 fake 收到 signal 后自行 throw”不能证明 timeout 边界。

**Refactor**：用 native AbortSignal 组合，清理 timer/listener；给 execution promise 提前挂 late rejection handler，fake timers 下无 open handles。

### Exercise 04-C：User abort 优先

**Red**：在 timeout 前触发 run abort，当前统一 catch 可能写成 timeout/FAILED。

**Green**：记录 abort source，tool step/run/message 均 ABORTED，不重试、不发下一轮。

**Refactor**：集中 `classifyCancellation(runSignal, timeoutSignal)`，避免 catch 分支复制判断。

再增加 late settlement：timeout 已完成状态转换后，executor 才 resolve 或 reject。断言 step/run 不二次转换、不发下一轮 sampling，reject 不成为 unhandled rejection。

### Exercise 04-D：Oversized output

**Red**：fake 返回超大 JSON；第二轮 prompt 与 AgentStep 都包含全部内容。

**Green**：构建 model envelope 与更小 durable summary，保留 original size/truncated marker。

**Refactor**：序列化/限制/脱敏作为独立纯函数，覆盖 Unicode 与 circular/non-serializable error。

### Exercise 04-E：Secret redaction

**Red**：executor throw `Authorization: Bearer sk-secret-123`，断言 DB/model 不含该字符串。

**Green**：日志 detail 与 safe error 分离；持久化使用 allowlist，不依赖事后正则清理所有对象。`cause` 进入 server log 前也必须有长度限制和 redaction，不能因为“仅服务端可见”就原样展开 Error/stack/raw metadata。

**Refactor**：公共 redactor 仅作为第二层防护；首要手段仍是不要把 raw object 传入 recorder/logger。测试捕获 logger sink，与 DB/model observation 一起断言 secret nowhere。

### Exercise 04-F：Budget

分别覆盖 sampling、tool call、run duration、tool output 大小。每个 budget 在发起下一操作前检查，超限操作调用次数必须保持 0。

### Exercise 04-G：Retry 所有权

对 timeout、retryable execution error、idempotent=true 各跑一次，断言本阶段 executor 调用次数始终为 1、`executionAttempt=1`。把“是否创建第二 attempt”作为 Phase 07 的 durable recovery 决策，不在当前单进程 catch 分支实现。

## 5. 测试矩阵

| ID | Case | Step 期望 | Run/Message 期望 | 附加断言 |
| --- | --- | --- | --- | --- |
| P04-S01 | golden 2 samplings | 6 条顺序完成 | COMPLETED | 可重建链路 |
| P04-S02 | second sampling fails | sampling#2 FAILED | FAILED | 前序保持完成 |
| P04-S03 | duplicate terminal update | 第二次 update 拒绝 | 不变 | invariant error |
| P04-T01 | tool timeout | tool FAILED(timeout) | 按策略 FAILED | 有限时间结束 |
| P04-T01B | executor ignores signal forever | tool FAILED(timeout) | 有限结束 | outer race 不等待 executor |
| P04-T02 | abort before timeout | tool ABORTED | ABORTED | 非 timeout |
| P04-T03 | completes before timeout | tool COMPLETED | 继续 | timer 清理 |
| P04-T04 | completion/timeout race | 单一终态 | 单一终态 | 重复运行稳定 |
| P04-T05 | late resolve/reject after timeout | 保持 FAILED(timeout) | 不变 | 无 next sampling/unhandled rejection |
| P04-E01 | invalid args | safe failed step/observation | 按策略 | executor=0 |
| P04-E02 | throw with secret | FAILED | FAILED/降级 | DB/observation/logger secret nowhere |
| P04-O01 | output at limit | not truncated | 继续 | exact boundary |
| P04-O02 | output over limit | truncated envelope | 继续 | originalChars |
| P04-O03 | Unicode over limit | valid string | 继续 | 无 replacement corruption |
| P04-B01 | sampling limit | 无超限 step/request | FAILED | exact count |
| P04-B02 | tool limit | 无超限 executor call | FAILED | exact count |
| P04-B03 | run deadline | active step 收口 | FAILED/ABORTED按定义 | 无 unfinished |
| P04-R01 | non-idempotent retryable | 1 attempt | FAILED | Phase 04 不重试 |
| P04-R02 | idempotent nonretryable | 1 attempt | FAILED | Phase 04 不重试 |
| P04-R03 | idempotent retryable | 1 attempt | FAILED | 仍不重试；留 Phase 07 |

## 6. 数据库验收查询

阶段任务实现后，应为一个真实/测试 run 查询：

```text
AgentRun
  id/status/startedAt/endedAt

AgentStep ordered by sequence
  id/type/status/startedAt/endedAt/input/output/errorMessage

Assistant Message
  status/content
```

检查：

- sequence 无重复、无间隙是否为硬要求需提前定义；至少严格递增且唯一。
- terminal step 有 endedAt。
- RUNNING run 的 endedAt 为空；terminal run 的 endedAt 非空。
- tool callId 可从 step 找到，但 raw secret/巨量 output 不可见。
- Message 只有最终用户可见文本。

## 7. 阶段 5 收口验收场景

必须用一个完整 scenario 串起：

1. 用户发送 URL 分析请求。
2. Run/Message 创建。
3. 第一轮 sampling 请求 tool。
4. 后端验证并执行 `analyze_url_structure`。
5. 安全 observation 回填。
6. 第二轮模型生成最终回答。
7. NDJSON 对外只发最终回答生命周期。
8. DB 可查询两轮 sampling + 一次 tool 的 steps。
9. 正常、工具失败、用户 abort 三种终态无未完成 step。

## 8. 验收证据模板

```md
### P04-T02 abort beats timeout

- Requirement：用户主动停止必须记录 ABORTED，而不是 timeout/FAILED。
- Test：`...`。
- Timing：tool timeout=1000ms；user abort at fake 100ms。
- Tool step：ABORTED / code=aborted。
- Run：ABORTED。
- Message：ABORTED，保留策略符合 Phase 00。
- Sampling count after abort：0 additional。
- Unfinished steps：0。
- Result：PASS。
```

总体验收：

- [ ] dynamic step API 与 schema 证据。
- [ ] golden run step 查询结果。
- [ ] timeout/abort/race 测试。
- [ ] uncooperative executor 与 late settlement 测试。
- [ ] budget boundary 测试。
- [ ] output size/Unicode 测试。
- [ ] secret redaction 测试。
- [ ] no-retry ownership 测试（所有错误 executionAttempt=1）。
- [ ] logger capture 与 DB/model 三处 secret-none 证据。
- [ ] completed/failed/aborted 全部 unfinished=0。
- [ ] 完整阶段 5 scenario。
- [ ] Prisma generate/validate（如需要）、test/typecheck/lint/diff-check 输出。

## 9. 非目标

- 不做审批 UI 或 Approval 表。
- 不做 sandbox。
- 不做外部写操作工具。
- 不做并行。
- 不做跨进程恢复。
- 不把 full prompt/chain-of-thought 存进 step。
- 不新增前端时间线。

## 10. 源码路径

### 实现关注点

- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/llm/llm.errors.ts`
- `prisma/schema.prisma`
- `packages/contracts/src/agent-run.ts`
- Phase 02 实际 tools 目录。

### Codex 对照

- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/orchestrator.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/parallel.rs`
- `/Users/ayu/Desktop/codex/codex-rs/rollout/src/policy.rs`
- `/Users/ayu/Desktop/codex/codex-rs/rollout/src/recorder.rs`
- `/Users/ayu/Desktop/codex/codex-rs/rollout/src/recorder_tests.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/context_manager/history.rs`

## 11. 复盘问题

1. 一条 tool execution step 的最小安全字段有哪些？
2. step sequence 由应用生成还是数据库生成？并发下如何保证？
3. timeout 后外部操作可能仍继续，系统应该怎样记录这一事实？
4. output 给模型和 output 给审计为什么需要不同限制？
5. allowlist 持久化为什么比“先存 raw 再打码”安全？
6. 哪些错误应该允许模型基于 observation 自我修正？
7. 阶段 5 的最终验收里，哪份证据证明可靠性而非单次演示？
8. 下一阶段 Human-in-the-loop 需要复用哪些 risk/error/step 基础？
9. 为什么 idempotent=true 仍不足以在本阶段安全地自动 retry？
