# Phase 01 实践与验收：用结构化事件保住模型意图

## 1. 实践目标

把“模型流就是字符串”升级为“模型流是项目自有事件序列”。练习完成后，provider adapter 能还原跨 chunk tool call，runtime 仍能把纯文本按原 NDJSON 协议发送给前端。

## 2. 前置条件

- Phase 00 测试基座与 fake 已完成。
- 已建立 SDK chunk fixtures，不使用真实 API。
- 已写明公开 `ChatStreamEvent` 本阶段不变化。
- 已读 [source-reading.md](./source-reading.md)。

## 3. 实践设计

### 3.1 先定义 contract fixture

先不改 SDK adapter，写出期望 event：

```ts
const expected: ModelStreamEvent[] = [
  {
    type: 'tool_call_completed',
    providerCallId: 'call_1',
    name: 'inspect_seo_page',
    argumentsJson: '{"url":"https://example.com"}',
    index: 0,
  },
  { type: 'response_completed', finishReason: 'tool_calls' },
]
```

字段命名必须体现这是 provider-side、尚未验证的 call envelope；Phase 02 只有在 JSON parse、registry lookup 和 schema validation 全部成功后才建立 `ValidatedToolInvocation`。不要把 `tool_call_completed` 误读成“允许执行”。

### 3.2 构造分片 fixture

至少准备：

1. 纯文本两段。
2. 单 tool 完整一个 chunk。
3. id、name、arguments 分别跨 3-5 chunks。
4. 两个 index 交错。
5. tool call 后 `finish_reason=tool_calls`。
6. 请求参数含 `stream_options.include_usage=true`；使用量在 `choices=[]` 的 usage-only terminal chunk 才出现。
7. stream 在 terminal 前 EOF。
8. SDK iterator 抛网络错误与 AbortError；它们不被包装成 `ModelStreamEvent.error`。

fixture 应只服务 adapter tests，不传到 runtime fake；runtime fake 直接产 `ModelStreamEvent`。

### 3.3 Runtime reducer 规则

本阶段 reducer 至少明确：

| Model event | 当前处理 |
| --- | --- |
| text_delta | 拼 content，yield assistant_delta |
| usage | 暂存或忽略但分支显式存在 |
| response_completed(stop) | 允许正常结束 |
| response_completed(length/filter) | 明确失败或不完整终态 |
| tool_call_completed | Phase 03 前 fail-fast/feature gate，不静默丢失 |
| response_completed(tool_calls) | 不可直接 complete AgentRun |

adapter 应在观察到 finish reason 后继续读取可能晚到的 usage-only chunk，并在 clean EOF 才发唯一 `response_completed`。因此 runtime reducer 看到的正常顺序是 `text/tool* -> usage? -> response_completed`；错误和取消不会伪装成 value event，而是从 iterator throw。

## 4. Red-Green-Refactor

### Exercise 01-A：纯文本兼容

**Red**：把 LLM 返回类型改为 union 后，现有 `content += contentDelta` 类型报错或测试失败。

**Green**：只处理 `text_delta` 并保持 event 序列、content 和外部协议与 Phase 00 一致。

**Refactor**：抽出小型 reducer 时，不能把 run 持久化也塞进 provider adapter。

### Exercise 01-B：跨 chunk 单工具

**Red**：输入 args `'{"ur'`、`'l":"x'`、'"}'，当前 adapter 不产 event。

**Green**：按 index 累积并在 terminal 时产一个完整 candidate。

**Refactor**：把 buffer 状态收敛到 `ToolCallAccumulator` 等纯对象；不为一个 provider 建抽象工厂。

### Exercise 01-C：两个工具交错

**Red**：证明单一 string buffer 会得到无效拼接。

**Green**：index 0/1 分开累积，按明确顺序 finalize。

**Refactor**：对 id/name/args 使用相同 append primitive，但保留必填字段验证。

### Exercise 01-D：不完整 terminal

**Red**：无 finish reason 的 EOF 被现有 for-await 当正常结束。

**Green**：adapter 或 LLM service 抛出可诊断的 incomplete stream error。

**Refactor**：将网络错误、协议不完整、用户中断区分开，避免统一变成 `LLMNetworkError` 丢失原因。

### Exercise 01-E：Usage-only terminal chunk

**Red**：fixture 先给 `choices[0].finish_reason='stop'`，再给 `{ choices: [], usage: ... }`；若 adapter 在 finish reason 处 return，usage 会丢失。

**Green**：断言请求启用 `include_usage`，adapter 继续读到 clean EOF，并按 `usage -> response_completed` 输出。

**Refactor**：把 `choices` 与 `usage` 解析分开；不得用 `const choice = choices[0]; if (!choice) continue` 跳过整个 chunk。

## 5. 测试矩阵

| ID | 层级 | 输入 | 期望 |
| --- | --- | --- | --- |
| P01-A01 | adapter | text chunks + stop | text_delta* + completed(stop) |
| P01-A02 | adapter | one complete tool call | 1 tool event + completed(tool_calls) |
| P01-A03 | accumulator | args 5 分片 | 字符级一致 |
| P01-A04 | accumulator | name/id 分片 | 完整字段 |
| P01-A05 | accumulator | index 0/1 交错 | 独立且顺序确定 |
| P01-A06 | adapter | usage terminal | usage 值归一化 |
| P01-A07 | adapter | finish length | completed(length) |
| P01-A08 | adapter | unknown reason | completed(unknown) |
| P01-A09 | adapter | missing id/name | diagnostic error |
| P01-A10 | adapter | EOF before terminal | incomplete error |
| P01-A11 | request mapper | stream request | `include_usage=true` |
| P01-A12 | adapter | finish chunk + `choices=[]` usage chunk | usage 后才 completed，terminal 仅一次 |
| P01-A13 | adapter/runtime | iterator throws network/abort | 无 error value；runtime 分别 FAILED/ABORTED 且只一次 |
| P01-R01 | runtime | text model events | Phase 00 happy 完全等价 |
| P01-R02 | runtime | tool event before loop exists | 显式未支持，run 不假完成 |
| P01-R03 | runtime | abort during adapter | ABORTED 基线不变 |
| P01-C01 | contract | all runtime events | 外部 ChatStreamEvent 未新增类型 |

## 6. 负面验证

除了绿色 case，还应主动证明以下错误不会发生：

- runtime import `openai/resources/chat/completions`。
- `ChatStreamEvent` 出现 SDK finish_reason。
- arguments 每到一个 delta 就 `JSON.parse`。
- `tool_calls` terminal 被当作 done。
- unknown finish reason 导致 exhaustive switch 在运行时静默掉落。
- abort 被包装成普通 provider failure，最终写成 FAILED。
- adapter 同时 yield error event 与 throw，runtime 因而生成两个 terminal。
- `choices=[]` 被当作非法或被直接跳过，usage 永久丢失。

## 7. 验收证据

```md
### P01-A05 two interleaved tool calls

- Requirement：不同 tool index 的 id/name/arguments 不得串线。
- Fixture：`.../fixtures/two-interleaved-tool-calls.ts`。
- Expected：call_0/get_page/{...}；call_1/get_serp/{...}。
- Test：`...`。
- Result：PASS。
- Evidence：事件快照或完整对象断言。
- Remaining risk：provider 复用 index 或缺少 id 时的兼容策略。
```

阶段总体验收：

- [ ] contract、adapter、accumulator、runtime 四类测试分别存在。
- [ ] 纯文本现有行为无回归。
- [ ] tool call 多 chunk 与多 index 已覆盖。
- [ ] terminal/usage/unknown/incomplete 已覆盖。
- [ ] `include_usage` 请求与 `choices=[]` usage-only chunk 已覆盖，usage 位于 completed 之前。
- [ ] provider error/abort 只走 iterator throw，runtime 没有双重收口。
- [ ] AbortSignal 仍能中止底层读取并收口为 ABORTED。
- [ ] 没有 raw SDK 类型跨出 adapter。
- [ ] 外部 NDJSON contract 无变化。
- [ ] test/typecheck/lint/diff-check 全部有结果记录。

## 8. 非目标

- 不验证工具是否注册。
- 不 parse + schema validate tool arguments。
- 不把 tool result 回填模型。
- 不实现第二次 sampling。
- 不新增 ToolStep 数据库记录。
- 不暴露 tool event 给 Vue。
- 不处理并行执行。

## 9. Opt-in 真实 Provider Smoke

fixture suite 是默认验收；另外保留一条**人工显式启用、默认 CI 不运行**的真实 provider smoke，用来发现兼容服务对 `tool_calls`、`parallel_tool_calls`、`stream_options.include_usage` 的真实差异。建议约束：

- 仅 `RUN_LIVE_MODEL_SMOKE=1` 且测试专用凭证存在时运行。
- 请求一个无副作用、低 token 的 synthetic tool spec，并设置 `parallel_tool_calls=false`。
- 断言至少得到一个完整 unvalidated envelope、一个 terminal；若 provider profile 宣称支持 usage，再断言 usage。
- 不断言模型自然语言全文，不把原始请求、API key、完整 arguments 写日志或 snapshot。
- smoke 失败标记为 provider compatibility evidence，不可取代 deterministic fixture tests。

## 10. 源码路径

### 预计实现点

- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/clients/openai-compatible.client.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- 对应 adapter/runtime tests 与 fixtures。

### Codex 对照

- `/Users/lihaoran/Desktop/codex/codex-rs/codex-api/src/common.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/client_common.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/client.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/protocol/src/models.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/client_tests.rs`

## 11. 复盘问题

1. 本阶段新增的最重要 contract 是哪个？它保护了什么？
2. 为什么 runtime fake 与 SDK chunk fixture 必须分层？
3. 哪个测试能证明 arguments 没有被错误标准化或丢字符？
4. `length` 应映射为 FAILED、COMPLETED-with-warning 还是新终态？你的项目决策依据是什么？
5. tool event 在 Phase 03 前为何应 fail-fast？
6. 若以后换 Responses API，哪些文件应该变化，哪些不应该？
7. 哪些 metadata 现在没有用但值得保留，哪些属于 YAGNI？
8. 为什么真实 provider smoke 不能替代 fixture tests，又为什么仍值得保留？
