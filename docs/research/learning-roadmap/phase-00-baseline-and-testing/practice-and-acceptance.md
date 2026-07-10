# Phase 00 实践与验收：把阶段 4 变成可回归基线

## 1. 实践目标

本练习最终要交付一个无网络、可重复、能精确驱动 Agent Runtime 的测试基座。重点不是“安装一个测试库”，而是证明：已有文本流在成功、失败、中断三条路径上，event 与持久化事实一致。

## 2. 前置条件

- 已完成 [README.md](./README.md) 的不变量清单。
- 已按 [source-reading.md](./source-reading.md) 读完 Codex 的 test harness 与当前调用链。
- 当前改动范围必须落到独立执行任务；本研究文件本身不表示已经安装依赖或已有测试。
- 测试默认不得读取 `.env` 中的真实 `LLM_API_KEY`。

## 3. 建议实现设计

### 3.1 目录建议

实现时可采用靠近源码的 `*.spec.ts`，或集中 `test/` 目录；关键不是风格，而是职责清楚：

```text
apps/api/
  src/
    agent-runtime/
      agent-runtime.service.spec.ts
      agent-run-recorder.service.spec.ts
    seo/
      seo-chat-stream-event.mapper.spec.ts
  test/
    support/
      scripted-llm.fake.ts
      runtime-state.fake.ts
      collect-async-generator.ts
```

如果项目选择 co-location，应避免把大型 fixture 塞进 production 文件；如果选择集中目录，应保持 import 路径清楚。

### 3.2 事件收集器

建议 helper 接受 async iterable 并完整收集：

```ts
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of source)
    result.push(item)
  return result
}
```

abort case 不能直接完整 collect 一个永不结束的 fake；应让 fake 在收到 signal 后退出或抛出 SDK 等价取消错误，再等待 generator 收口。

### 3.3 最小状态快照

每条 runtime 测试输出一个结构化快照：

```ts
{
  events: ['run_started', 'assistant_delta', 'run_completed'],
  assistant: { content: 'AB', status: 'COMPLETED' },
  run: { status: 'COMPLETED', ended: true },
  steps: [
    ['receive_user_message', 'COMPLETED'],
    ['load_conversation_history', 'COMPLETED'],
    ['call_llm', 'COMPLETED'],
    ['stream_assistant_reply', 'COMPLETED'],
  ],
}
```

快照只用于易读差异；关键不变量仍应有显式断言，避免一次无意更新 snapshot 接受错误行为。

## 4. Red-Green-Refactor 实践

### 4.1 Red 1：测试命令不存在

操作：尝试从根 workspace 调用约定 test script。

期望 Red：脚本不存在或没有测试运行器。记录原始输出，说明这是基线缺口，不是代码 bug。

### 4.2 Green 1：最小纯函数测试

目标：为 `toChatStreamEvent()` 写第一条测试，输入 `run_started`，断言输出 `start` 且不包含 `runId`。

限制：不启动 Nest app、不连接 DB、不 mock OpenAI SDK。

### 4.3 Refactor 1：表驱动 mapper cases

当五种事件都有 case 后，再抽 case table。保持每个 case 的期望对象完整可读。

### 4.4 Red 2：runtime 无法编排

写 happy path 测试：模型依次 yield `你`、`好`。如果因 concrete service、Prisma 或配置阻塞，保留失败作为 seam 证据。

### 4.5 Green 2：scripted fake 与 state fake

最小实现应让测试：

1. 创建 conversation fixture。
2. 调用 `runTurnStream()`。
3. 收集 event。
4. 查询 fake state 的 Message/Run/Step。
5. 断言 content 与终态。

### 4.6 Red 3 / Green 3：失败路径

- fake yield `半` 后 throw `provider unavailable`。
- 断言 terminal event 为 `run_failed`。
- 断言 partial content 的保存策略与当前 production 一致。
- 断言没有 `run_completed`。

### 4.7 Red 4 / Green 4：中断路径

- fake yield `半` 后等待 signal。
- 测试调用 `abortController.abort()`。
- fake 结束或抛取消异常。
- 断言 terminal event 为 `run_aborted`，content 保留为 `半`。
- 断言所有 PENDING/RUNNING step 均进入 `ABORTED`。

### 4.8 Refactor 2：统一 harness

仅当三条 runtime 测试重复以下步骤时，抽 `createRuntimeHarness()`：fixture、fake 组装、event 收集、state snapshot。不要把断言藏进 harness；测试仍要清楚表达期望。

## 5. 完整测试矩阵

| 编号 | 层级 | 场景 | 模型脚本/输入 | Event 断言 | Durable state 断言 |
| --- | --- | --- | --- | --- | --- |
| P00-U01 | unit | started mapper | run_started | start 字段完整 | 不涉及 |
| P00-U02 | unit | delta mapper | assistant_delta | contentDelta 保留 | 不涉及 |
| P00-U03 | unit | completed mapper | run_completed | done content/time | 不涉及 |
| P00-U04 | unit | failed mapper | run_failed 无 messageId | optional 字段不伪造 | 不涉及 |
| P00-U05 | unit | aborted mapper | run_aborted | partial content 保留 | 不涉及 |
| P00-S01 | service | recorder complete | 依次 start/complete | 不涉及 | Run/Steps 均终态 |
| P00-S02 | service | recorder fail | active call_llm | 不涉及 | active step 有 error |
| P00-S03 | service | recorder abort | streaming step | 不涉及 | 未完成 step 全 ABORTED |
| P00-R01 | runtime | happy | delta A,B | start,A,B,done | content=AB, COMPLETED |
| P00-R02 | runtime | empty stream | 无 delta后结束 | start,done | content='', COMPLETED |
| P00-R03 | runtime | partial then error | A,throw | start,A,error | partial+FAILED |
| P00-R04 | runtime | error before assistant | 立即 throw | start 后语义按现状锁定 | Run FAILED，无残留 |
| P00-R05 | runtime | partial then abort | A,wait | start,A,aborted | partial+ABORTED |
| P00-R06 | runtime | pre-aborted signal | signal 已 abort | 不出现 done | 状态完全收口 |
| P00-C01 | contract | recent history | 12+ messages | model input 最多 12 | 顺序为 oldest->newest |

注意：`error before assistant` 的精确 event 序列应以当前实现测试结果为基线；若发现设计缺陷，先记录再开修复任务，不要在写测试时悄悄改语义。

## 6. 验收执行顺序

1. 运行 mapper 单元测试。
2. 运行 recorder service 测试。
3. 运行 runtime happy/error/abort。
4. 重复运行 runtime suite 20 次，排查竞态和假通过。
5. 运行 API 包 typecheck 与 lint。
6. 运行 workspace typecheck、lint 和 `git diff --check`。
7. 如有真实数据库 contract test，确认测试数据隔离和清理策略。

不能运行某项时，应记录“未验证”，不得写 PASS。

## 7. 验收证据模板

```md
### P00-R05 partial then abort

- Requirement：Abort 后只能产生 run_aborted，且保留 partial content。
- Test：`.../agent-runtime.service.spec.ts` / `aborts an active stream`。
- Input：delta='半' -> wait_for_abort。
- Events：run_started -> assistant_delta('半') -> run_aborted。
- State：Message=ABORTED('半')；Run=ABORTED；无 PENDING/RUNNING Step。
- Command：`pnpm ...`。
- Result：PASS / FAIL / NOT RUN。
- Remaining risk：尚未经过真实 OpenAI SDK 的 APIUserAbortError。
```

阶段完成时，至少为 P00-R01、P00-R03、P00-R05 分别填写一次，不能只贴一张“all tests passed”截图。

## 8. 非目标

- 不把真实 DeepSeek 响应录成固定 cassette。
- 不在本阶段测试 tool arguments 拼接。
- 不实现 provider event union。
- 不把 integration test 等同于必须启动浏览器。
- 不为覆盖率数字创建无意义 getter 测试。
- 不让 fake 访问 production `.env`。
- 不修改现有 UI stream 形状。

## 9. 源码路径与预计证据路径

### 被测源码

- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
- `apps/api/src/llm/llm.service.ts`
- `prisma/schema.prisma`

### Codex 对照

- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/responses.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/test_codex.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/suite/tool_harness.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/suite/abort_tasks.rs`

### 实现后应出现的证据

- test scripts。
- fake/harness 文件。
- mapper/recorder/runtime 测试文件。
- 命令输出或 CI job 链接。
- `progress-tracker.md` 中 Phase 00 证据登记。

## 10. 复盘问题

1. happy path 为什么必须同时断言事件与数据库？
2. partial then error 与 partial then abort 的用户可见内容可以相同吗？终态为何必须不同？
3. 哪个测试在 Phase 03 会自然扩展为两次 sampling？
4. 测试重复运行 20 次希望发现什么？
5. fake time 是否必要？不用 fake time 时怎样避免脆弱的毫秒断言？
6. 如果出现 PENDING step，应该修测试还是修 production 状态机？判断证据是什么？
7. 为什么不在这一阶段直接追求 HTTP + DB + 真模型端到端测试？
