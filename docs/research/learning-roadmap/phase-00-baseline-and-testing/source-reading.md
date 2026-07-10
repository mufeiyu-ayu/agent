# Phase 00 源码阅读：从“测试很多”提炼出可复用基座

## 1. 阅读目标

本文件的目标不是通读 Codex 测试，而是用两条窄路径回答：

1. 成熟 Agent 如何用可编排模型响应验证多轮运行？
2. 当前项目哪些边界必须先可替换，Phase 01-04 才能安全演进？

读完后应能画出 `test -> fake provider -> runtime -> events/state -> assertions` 的最小图，并能指出当前项目缺少的 seam。

## 2. 前置条件

- 先读本阶段 [README.md](./README.md)。
- 能追踪 async generator 的 yield / throw / return。
- 知道测试 double 中 fake、stub、spy 的区别：fake 有最小行为，stub 返回预设值，spy 记录交互。
- 不要求理解 Rust 宏、Tokio executor 或 wiremock 的全部实现。

## 3. Codex 阅读路线

### 路线 A：可编排模型响应

#### A1. 测试组装入口

路径：`/Users/ayu/Desktop/codex/codex-rs/core/tests/common/test_codex.rs`

观察：

- `TestCodex` 如何把运行实例、临时 cwd、配置和 mock server 组合在一起。
- builder 为什么只暴露测试关心的旋钮。
- fixture 返回哪些句柄，测试后续如何观察事件与请求。

设计问题：当前项目的等价物不需要复制完整 Nest app；最小 `RuntimeTestHarness` 需要哪些对象？建议只包含 runtime、scripted model、state store 和事件收集器。

#### A2. SSE 响应构造

路径：

- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/responses.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/streaming_sse.rs`

重点搜索：`ev_response_created`、`ev_assistant_message`、`ev_function_call`、`ev_completed`、`mount_sse_once`。

记录三点：

1. 测试用语义 helper 构造事件，而不是每个 case 手写原始 SSE JSON。
2. 响应按次挂载，因此能证明第一轮与第二轮 sampling 的差异。
3. mock server 既提供输入，也捕获 runtime 发出的下一次请求。

迁移到当前项目：Phase 00 fake 先用脚本数组；Phase 01 provider adapter test 才需要构造 OpenAI-compatible chunk。两层不要混成一个 fake。

#### A3. 完整 Tool harness 示例

路径：`/Users/ayu/Desktop/codex/codex-rs/core/tests/suite/tool_harness.rs`

只读第一个“模型请求工具 -> 工具执行 -> 第二轮模型回答”测试。关注：

- 第一轮 response 含 function call。
- 第二轮 response 含 assistant message。
- 测试捕获第二轮 request，并按 `call_id` 找到 output。
- 完成条件由 TurnComplete 事件证明，而不是 sleep 一段时间后猜测。

Phase 00 暂时不实现工具，但测试基座必须为“按次响应、捕获每次输入”留出能力。

### 路线 B：不同层级各自测试

#### B1. Registry 单元测试

路径：`/Users/ayu/Desktop/codex/codex-rs/core/src/tools/registry_tests.rs`

关注 TestHandler 如何把复杂外部环境缩成最小 executor，以及测试为什么直接验证注册与 dispatch 规则。

#### B2. Router 单元测试

路径：`/Users/ayu/Desktop/codex/codex-rs/core/src/tools/router_tests.rs`

关注 `build_tool_call_uses_namespace_for_registry_name`：输入一个完整 `ResponseItem`，断言得到项目内部 `ToolCall`。这是 adapter/纯转换测试，不需要启动整个 runtime。

#### B3. 中断测试

路径：`/Users/ayu/Desktop/codex/codex-rs/core/tests/suite/abort_tasks.rs`

只找一条 cancellation token 从外部操作传播到运行任务的测试，记录它断言了哪些终态。不要深挖 OS process kill 细节，当前项目只需 AbortSignal。

## 4. 当前项目阅读路线

### C1. 从外部入口看 AbortSignal

1. `apps/api/src/seo/seo.controller.ts`
2. `apps/api/src/seo/seo.service.ts`
3. `apps/api/src/agent-runtime/agent-runtime.types.ts`
4. `apps/api/src/agent-runtime/agent-runtime.service.ts`
5. `apps/api/src/llm/llm.service.ts`
6. `apps/api/src/llm/clients/openai-compatible.client.ts`

在纸上标出 signal 每次传递的位置。思考：runtime 测试应从 controller close 事件开始，还是直接传 `AbortController.signal`？本阶段应优先直接测试 runtime，controller framing 另做一条窄测试。

### C2. 从 runtime event 看外部协议

1. `apps/api/src/agent-runtime/agent-runtime.types.ts`
2. `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
3. `packages/contracts/src/seo.ts`
4. `apps/web/src/api/seo.ts`

记录内部 `runId` 为什么没有进入外部 stream contract。测试应保护“内部可增长、外部谨慎变化”这一边界。

### C3. 从 run 创建看到终态

1. `AgentRuntimeService.runTurnStream()` 中 `createRunWithInitialSteps`。
2. `AgentRunRecorderService.startStep/completeStep/failRun/abortRun`。
3. `prisma/schema.prisma` 的四种 status enum。

把每条分支写成表：进入条件、active step、Message status、Run status、Step status、terminal event。

## 5. 建议设计笔记

阅读时创建一张“测试 seam”表：

| 依赖 | 当前创建/注入方式 | 测试希望控制什么 | 最小 seam |
| --- | --- | --- | --- |
| LLM | 注入 `LLMService` | delta/throw/abort 顺序 | scripted fake service 或 model port |
| Prisma | 注入 `PrismaService` | 查询结果与最终状态 | stateful fake + 少量真实 DB contract |
| 时间 | 直接 `new Date()` | started/ended 一致性 | fake timer 或关系断言 |
| ID | Prisma 生成 | 易读 fixture | fake store 固定 ID |
| event consumer | async iteration | 完整顺序 | collector helper |

若为了测试需要增加接口，接口名称应表达业务端口，如 `ModelGateway`，而不是 `MockableLLMService`。

## 6. 非目标与可跳过内容

- 跳过 Codex Bazel/Cargo workspace 配置细节。
- 跳过所有平台 sandbox、shell PTY 和 Windows 专属 fixture。
- 不统计 Codex 测试数量，也不追求同等规模。
- 不阅读 Multi-agent、MCP、plugins 的测试。
- 不因 Codex 使用 mock HTTP server 就强制当前所有 runtime 测试走 HTTP。

## 7. Red-Green-Refactor 阅读练习

### Red

- 写出一个当前无法稳定构造的场景：模型输出一个 delta 后等待，测试触发 abort。
- 标出阻碍它的真实依赖或不可观察状态。

### Green

- 只设计一个 seam，使测试可以控制该场景。
- 画出事件收集与状态读取路径。

### Refactor

- 比较 Codex `TestCodex` 与你设计的 harness；删掉当前项目用不到的配置、网络服务器、平台字段。
- 确认 helper 名称表达语义而不是底层 JSON。

## 8. 测试矩阵（阅读后应能提出）

| 被测边界 | 输入构造 | 观察输出 | 不应依赖 |
| --- | --- | --- | --- |
| mapper | union fixture | 单个外部 event | DB、HTTP |
| recorder | 固定 run fixture | 最终 rows | 模型 SDK |
| runtime | scripted model | events + rows | 公网 |
| provider adapter | SDK chunk fixture | model events | Prisma |
| controller | fake service events | NDJSON 行 | 真模型 |

## 9. 验收证据

- [ ] 一张 Codex test harness 调用链图。
- [ ] 一张当前项目 test seam 表。
- [ ] 至少记录 3 个 Codex helper 的职责，而不是只记文件名。
- [ ] 写出 happy/error/abort 对应的状态表。
- [ ] 明确 Phase 00 fake 与 Phase 01 provider fixture 的边界。
- [ ] 指出一项 Codex 测试设施没有迁移的理由。

## 10. 源码路径速查

### Codex

- `codex-rs/core/tests/common/test_codex.rs`
- `codex-rs/core/tests/common/responses.rs`
- `codex-rs/core/tests/common/streaming_sse.rs`
- `codex-rs/core/tests/suite/tool_harness.rs`
- `codex-rs/core/tests/suite/abort_tasks.rs`
- `codex-rs/core/src/tools/registry_tests.rs`
- `codex-rs/core/src/tools/router_tests.rs`

以上路径根目录均为 `/Users/ayu/Desktop/codex/`。

### 当前项目

- `apps/api/src/seo/seo.controller.ts`
- `apps/api/src/seo/seo.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/llm/clients/openai-compatible.client.ts`
- `packages/contracts/src/seo.ts`
- `prisma/schema.prisma`

## 11. 复盘问题

1. Codex 为什么同时需要语义事件 helper 和 request 捕获器？
2. 当前项目最小 harness 比 `TestCodex` 少了哪些部分，为什么可以少？
3. provider adapter test 与 runtime test 各自应该 fake 哪一层？
4. 如果 fake 永远按 production 逻辑拼 content，会掩盖什么错误？
5. 如何证明测试没有偷偷访问公网？
6. 为什么等待某个 terminal event 比固定 sleep 更可靠？
7. 哪个状态只能通过最终存储投影验证，不能只看 stream event？
