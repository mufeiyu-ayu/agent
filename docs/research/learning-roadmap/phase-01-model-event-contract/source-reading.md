# Phase 01 源码阅读：从 Provider Stream 到稳定 Model Event

## 1. 阅读目标

沿 Codex 的一条真实链路理解：外部响应事件如何被定义、流化、消费并转换成更高层事实。阅读重点是事件层级和 terminal 语义，不是 Rust 语法。

## 2. 前置条件

- 已完成 Phase 00，能用 fake event 驱动 runtime。
- 先读本阶段 [README.md](./README.md) 的四层事件图。
- 对 OpenAI-compatible chat completion streaming 有基础认识。

## 3. Codex 源码路径

### Step 1：先看 canonical provider event

文件：`/Users/lihaoran/Desktop/codex/codex-rs/codex-api/src/common.rs`

定位 `ResponseEvent`，把 variant 分为四组：

| 分组 | 示例 | 对当前项目启发 |
| --- | --- | --- |
| lifecycle | Created、Completed | sampling 有独立生命周期 |
| content | OutputTextDelta、OutputItemDone | delta 与完成 item 不相同 |
| tool | ToolCallInputDelta、OutputItemDone(FunctionCall) | 参数分片与完整 call 分开 |
| metadata | RateLimits、ServerModel、usage | 元数据不应伪装成文本 |

特别看 `Completed { token_usage, end_turn, ... }`：一次 provider response 完成还携带“模型是否结束 turn”的信息，这证明“流结束”和“Agent run 完成”不能用同一个布尔值代替。

### Step 2：看流容器，不看具体 HTTP

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/client_common.rs`

定位：

- `Prompt`：输入 items、tools、parallel flag、instructions。
- `ResponseStream`：对上只暴露 `ResponseEvent`。
- `Drop`：consumer 停止读取时触发 cancellation。

问题：当前 `OpenAICompatibleClient` 如何在 consumer 不再读取时停止底层 SDK stream？AbortSignal 已有，但需要测试它是否贯穿升级后的 adapter。

当前项目采用单一错误通道：`ResponseStream`/SDK iterator 正常值映射为 `ModelStreamEvent`；网络、协议和取消异常继续由 iterator throw。不要再定义一个并行的 model `error` event。runtime 根据 input signal 与错误类型完成 FAILED/ABORTED 分类。

### Step 3：看 provider 映射与 terminal

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/client.rs`

只搜索：`ResponseEvent::Completed`、`OutputItemDone`、`RESPONSE_STREAM_CHANNEL_CAPACITY`。不要通读模型配置与认证。

记录：

- 哪些 provider 事件会被转发。
- 哪个事件决定 mapper task 退出。
- stream 没有 Completed 时如何处理。
- channel 如何把 producer 与 runtime consumer 解耦。

当前项目不必照搬 channel，但必须给“不完整 EOF”一个显式结果。

### Step 4：看 runtime 如何消费

文件：`/Users/lihaoran/Desktop/codex/codex-rs/core/src/session/turn.rs`

定位约 `1987` 附近的 `match ResponseEvent`，只读以下分支：

- `OutputItemDone`
- `Completed`
- `OutputTextDelta`
- `ToolCallInputDelta`

观察：delta 用于实时事件；完整 `ResponseItem` 才能转为持久化/工具事实；Completed 汇总 usage 和 follow-up。不要把该大函数结构完整复制进 NestJS。

### Step 5：看完整 ResponseItem

文件：`/Users/lihaoran/Desktop/codex/codex-rs/protocol/src/models.rs`

定位 `ResponseItem::FunctionCall` 与 `FunctionCallOutput`：

- call 包含 `name`、raw string `arguments`、`call_id`。
- output 使用相同 `call_id` 配对。
- 注释明确 arguments 在 wire 上是 JSON 字符串。

这直接支持当前项目在 model adapter 层保留 `argumentsJson: string`，到 Phase 02 再 parse + validate。

## 4. 当前项目源码路径

### A. 现有 provider adapter

文件：`apps/api/src/llm/clients/openai-compatible.client.ts`

从 `chatStream()` 开始，标出当前只读取：

```ts
chunk.choices[0]?.delta.content
```

然后列出被丢弃的候选字段：`delta.tool_calls`、`finish_reason`、usage、chunk id。不要立刻把所有字段都暴露；按本阶段 contract 选择。

再检查 request 是否发送 `stream_options: { include_usage: true }`。OpenAI-compatible Chat Completions 可能先在 choice 上给 finish reason，随后给一个 `choices=[]` 的 usage-only chunk。读代码时专门检查：

- usage 是否在访问 `choices[0]` 之前独立读取；
- adapter 是否过早在 finish reason 处 return；
- clean EOF 是否在已观察 finish reason 后合成唯一 completed；
- 未观察 finish reason 的 EOF 是否进入 iterator error channel。

### B. LLM 门面

文件：

- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/llm/llm.service.ts`

问题：类型注释说“不暴露原始 chunk”，方向正确；为什么返回 string 仍然过度压缩了信息？新的 contract 应继续坚持不暴露 SDK 类型。

### C. Runtime 与外部 mapper

文件：

- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
- `packages/contracts/src/seo.ts`

逐层写出一个文本 delta 的类型变化；再写一个 tool call 在当前何处消失。Phase 01 的目标是让它到达 runtime，Phase 03 才执行。

## 5. 阅读产出：事件所有权表

| 事实 | 应由哪层拥有 | 理由 |
| --- | --- | --- |
| SDK tool_calls index | provider adapter | provider wire 细节 |
| 完整 call id/name/raw args | ModelStreamEvent 中的 unvalidated envelope | runtime/router 需要，但尚不可执行 |
| tool 名是否注册 | ToolRegistry | 不是 provider 职责 |
| arguments schema 是否有效 | Tool executor/router | 依赖 tool definition |
| assistant 文本拼接 | AgentRuntime | Run 业务事实 |
| 浏览器 delta | SEO mapper/contracts | 产品 transport |
| usage 原始/归一化 | LLM/model event | 未来计费和 observability |
| provider/network/abort error | async iterator throw | 避免 value/error 双通道造成重复终态 |

## 6. 设计练习

拿一组交错 chunks，手动完成 accumulator 表：

| chunk | index | id delta | name delta | args delta | buffer after |
| --- | ---: | --- | --- | --- | --- |
| 1 | 0 | call_ | get_ | `{` | ... |
| 2 | 1 | call_b | get_serp | `{"q":` | ... |
| 3 | 0 | a | metrics | `"x"}` | ... |

写出最终两个 event 的顺序规则。建议按首次出现 index 或 provider completed item 顺序，不要依赖对象 key 枚举的偶然行为。

## 7. Red-Green-Refactor

### Red

- 用 fixture 喂现有 adapter，证明 tool_calls 被完全忽略。
- 用无 Completed 的流证明当前自然结束会被误认为正常完成。

### Green

- 先转文本与 completed。
- 加 accumulator，输出完整 tool event。
- 将未知 finish reason 归一化并记录原值（如果调试需要）。
- 对 usage-only chunk 先 emit usage，clean EOF 再 emit completed。

### Refactor

- 把纯 accumulator 与 SDK async iteration 分开测试。
- 不把 `ChatCompletionChunk` 放进 `llm.types.ts` 的公开 service contract。

## 8. 测试矩阵

| 阅读出的风险 | 最小 fixture | 预期测试 |
| --- | --- | --- |
| tool args 分片 | 3 chunks 同 index | 拼接完全一致 |
| 多 call 串线 | index 0/1 交错 | 两个独立 buffers |
| 缺 id | completed 前无 id | 明确 adapter error |
| finish reason 未知 | `new_reason` | unknown，不崩溃 |
| incomplete stream | 只有 Created/text | 不产 completed success |
| abort | 等待下一 chunk | signal 后停止 |
| late usage | finish reason 后 `choices=[]` + usage | usage 不丢，completed 最后且一次 |
| iterator error | SDK throw | 不生成 ModelStreamEvent.error，由 runtime 分类 |

## 9. 验收证据

- [ ] 标注过 Codex `ResponseEvent` 四类事件。
- [ ] 画出当前项目四层事件转换图。
- [ ] 完成一组两工具交错 chunk 手算。
- [ ] 写出 event 所有权表。
- [ ] 明确完整 tool call 与 tool argument delta 的不同用途。
- [ ] 画出 finish reason、usage-only chunk、clean EOF 和 completed 的精确顺序。
- [ ] 写明 value channel 与 iterator throw channel 的唯一所有权。
- [ ] 记录至少一个不照搬 Codex 的点，例如不引入 channel 或 Responses API 全量 item。

## 10. 非目标

- 不深读 Codex websocket/retry/auth 实现。
- 不复制所有 ResponseEvent variant。
- 不在阅读阶段选择 ToolRegistry API。
- 不讨论 tool 权限、sandbox、审批。
- 不改公开前端 contract。

## 11. 源码路径速查

- Codex `codex-rs/codex-api/src/common.rs`
- Codex `codex-rs/core/src/client_common.rs`
- Codex `codex-rs/core/src/client.rs`
- Codex `codex-rs/core/src/session/turn.rs`
- Codex `codex-rs/protocol/src/models.rs`
- 当前 `apps/api/src/llm/clients/openai-compatible.client.ts`
- 当前 `apps/api/src/llm/llm.types.ts`
- 当前 `apps/api/src/llm/llm.service.ts`
- 当前 `apps/api/src/agent-runtime/agent-runtime.service.ts`
- 当前 `packages/contracts/src/seo.ts`

## 12. 复盘问题

1. 为什么 `OutputTextDelta` 和 `OutputItemDone(Message)` 都存在？
2. 为什么 call arguments 在完成前不是合法 JSON 也很正常？
3. consumer drop 与 AbortSignal 的关系是什么？
4. 当前项目应复制 Codex 的 ResponseItem 全量 union 吗？为什么？
5. 谁负责把 provider finish reason 转成 Agent loop 的 `needsFollowUp`？
6. 如果 provider 在同一次 sampling 同时返回文本和 tool call，contract 能否表达？
7. 怎样避免 SDK 升级迫使 runtime 全面改类型？
8. 为什么 `choices=[]` 不能等同于流已完成或无有效数据？
