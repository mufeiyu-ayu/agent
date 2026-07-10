# Phase 00：基线与测试基座

## 1. 阶段定位

本阶段不是重新实现阶段 1-4，也不是提前开始 Tool Calling。它只解决一个基础问题：**当线性文本流即将升级为可循环、可调用工具的 Agent Runtime 时，我们如何证明旧行为没有被破坏，并能用可控输入复现每一种运行状态？**

当前仓库已经能创建 `Conversation`、`Message`、`AgentRun`、`AgentStep`，能通过 NDJSON 流式输出文本，并能把正常、失败、中断收口到数据库。但是仓库根 `package.json` 和 `apps/api/package.json` 目前没有测试脚本，源码中也没有 `*.spec.ts` / `*.test.ts`。因此“阶段 4 已完成”主要由人工运行、typecheck 和 lint 证明；这不足以保护阶段 5 即将引入的循环状态机。

## 2. 学习目标

完成本阶段后，应能做到：

1. 区分类型检查、单元测试、集成测试、contract test 和人工演示分别能证明什么。
2. 为 TypeScript + ESM + NestJS 项目选择并配置一个轻量测试运行器；建议优先评估 Vitest，但选择结论必须以仓库适配结果为准。
3. 用 fake model stream 精确编排文本 delta、异常和 AbortSignal，而不依赖真实 DeepSeek 网络请求。
4. 为 `AgentRuntimeService.runTurnStream()` 建立 happy / error / abort 三条基线。
5. 用断言同时检查 runtime event 序列和 `Message` / `AgentRun` / `AgentStep` 终态。
6. 建立“测试失败必须指出哪个状态不变量被破坏”的调试习惯。
7. 为 Phase 01-04 提供可复用 fake、fixture 与数据库替身，而不是每阶段重复搭脚手架。

## 3. 前置条件与当前证据

### 3.1 前置知识

- 熟悉 TypeScript discriminated union、`AsyncGenerator` 和 `AbortController`。
- 能看懂 NestJS provider 注入，但不要求掌握完整 testing module API。
- 理解 `Conversation`、`Message`、`AgentRun`、`AgentStep` 的区别。
- 已阅读 `docs/tasks/completed/phase-04-agent-runtime.md`。

### 3.2 当前项目起点

| 现有能力 | 真实入口 | 需要锁定的基线 |
| --- | --- | --- |
| Runtime 事件 | `apps/api/src/agent-runtime/agent-runtime.types.ts` | start -> delta* -> terminal |
| Turn 编排 | `apps/api/src/agent-runtime/agent-runtime.service.ts` | 正常、失败、中断都只能有一个终态 |
| Run/Step 记录 | `apps/api/src/agent-runtime/agent-run-recorder.service.ts` | 不残留非终态记录 |
| LLM 文本流 | `apps/api/src/llm/llm.service.ts` | async generator 顺序和异常传播 |
| Provider 适配 | `apps/api/src/llm/clients/openai-compatible.client.ts` | SDK 细节不泄漏到 runtime |
| 外部流协议 | `packages/contracts/src/seo.ts` | `start/delta/done/error/aborted` 暂不变化 |
| 外部映射 | `apps/api/src/seo/seo-chat-stream-event.mapper.ts` | 内部事件仍能稳定映射 |
| 持久化模型 | `prisma/schema.prisma` | Message/Run/Step 状态一致 |

### 3.3 本阶段先写下的运行不变量

1. 一次成功 run 只能产生一个 `run_started` 和一个 `run_completed`。
2. `run_started` 必须早于任何 `assistant_delta`。
3. `run_failed`、`run_aborted`、`run_completed` 互斥。
4. `run_completed.content` 等于所有 `assistant_delta.contentDelta` 按顺序拼接。
5. 成功后 assistant Message 为 `COMPLETED`，Run 为 `COMPLETED`，已启动 Step 均为终态。
6. provider 抛错后 assistant Message 与 Run 为 `FAILED`，不能继续发 delta 或 done。
7. AbortSignal 生效后 assistant Message 与 Run 为 `ABORTED`，已生成部分文本可以保留。
8. `finally` 只能补偿未收口的中断，不能制造第二个 terminal event。
9. 默认 deterministic suite 不得调用真实模型、真实余额 API 或公网；Phase 01/03 可另设显式 opt-in live smoke，但它不属于基线 suite。
10. fake 的调用记录必须让后续阶段检查“第几次 sampling 收到了哪些 messages”。

## 4. 设计：最小测试架构

### 4.1 建议的测试层次

```text
纯函数单元测试
  seo-chat-stream-event.mapper / prompt builder
          |
          v
Service 协作测试
  AgentRunRecorder + fake Prisma
          |
          v
Runtime 集成测试
  AgentRuntime + scripted fake model + in-memory repository
          |
          v
少量数据库 contract test
  Prisma transaction / status transition
```

不要一开始启动完整 HTTP server 和 PostgreSQL 来测所有分支。先让核心状态机在进程内、无网络、毫秒级运行；真正需要验证 Prisma transaction 或 NDJSON framing 时，再增加窄集成测试。

### 4.2 Scripted fake model

建议 fake 不只返回一个固定字符串，而是接受“每次 sampling 的脚本”。Phase 00 先支持三种动作，Phase 01 再扩成结构化事件：

```ts
type TextStreamScript
  = | { type: 'delta'; value: string }
    | { type: 'throw'; error: Error }
    | { type: 'wait_for_abort' }
```

fake 至少保存：

- 第几次调用。
- 本次收到的 `ChatMessage[]` 深拷贝。
- options 中 model、temperature、maxTokens。
- 是否收到与测试相同的 AbortSignal。
- yield 和 throw 的真实顺序。

这相当于前端测试里的“可编排 mock fetch”，但它测试的是模型端口，而不是把 OpenAI SDK chunk 直接塞进 runtime。

### 4.3 数据层替身边界

阶段 00 可分两层：

- runtime 快速测试使用 fake Prisma / repository，关注调用顺序和状态。
- 少量数据库 contract test 使用隔离数据库，关注 transaction 与 Prisma 查询行为。

不要只断言“某个方法被调用过”。应读取最终投影，证明同一个 `runId` 下的 run、step、assistant message 互相一致。

### 4.4 Fixture 设计

固定最小 fixture：

| Fixture | 关键字段 | 用途 |
| --- | --- | --- |
| conversation | `conversationId=c-1` | 所有运行共用的长期会话 |
| user message | `m-user-1` | 触发 run |
| assistant message | `m-assistant-1` | 接收流式结果 |
| run | `run-1` | 关联输入、输出和 steps |
| history | system 由 builder 注入，DB 仅 user/assistant | 防止把 UI history 与 model history 混为一谈 |

ID 固定能让失败 diff 易读；测试应避免依赖真实 CUID 与当前时间。时间相关断言用 fake clock 或只断言 `endedAt` 是否存在、先后关系是否成立。

### 4.5 测试脚本入口

本阶段实现任务应明确提供：

- workspace 根级 `test` 入口。
- API 包级 `test` 入口。
- 可 watch 的本地学习入口。
- CI/验收使用的一次性非 watch 入口。

具体脚本名应在实现时落到 `package.json`，本文不把尚未安装的依赖写成已完成事实。

## 5. 任务拆解

### Task 00.1：建立测试运行器

- 比较 Vitest 与 Node 原生 test runner 在 ESM、TypeScript、mock timer、coverage、Nest provider 测试上的成本。
- 选择一个并写一条决策记录。
- 先运行一个纯函数测试，证明解析、路径别名和 workspace 脚本正确。

### Task 00.2：建立 fake model port

- 让 runtime 测试不创建 OpenAI client。
- 支持 delta / throw / wait-for-abort。
- 记录每次调用输入，为后续 Tool loop 的第二次 sampling 断言做准备。

### Task 00.3：锁定运行状态机

- happy：两段 delta 后 complete。
- error：第一段 delta 后抛错。
- abort：收到一段 delta 后中止。
- 对每条路径同时检查 event 与持久化事实。

### Task 00.4：锁定外部协议映射

- 为 `toChatStreamEvent()` 的每个 union 分支建表驱动测试。
- 明确 runId 当前是内部事实，不泄漏到 `ChatStreamEvent`。
- 新增内部事件时，TypeScript exhaustive switch 必须提示未映射分支。

## 6. Red-Green-Refactor

### Red

1. 先写测试，证明仓库目前没有可运行的 test script。
2. 写 runtime 测试并让它因无法替换真实 `LLMService` 或 Prisma 而失败。
3. 写状态断言，暴露哪些依赖边界难以控制。

### Green

1. 只添加跑通测试所需的配置和 fake。
2. 不改公开 NDJSON contract。
3. 让 happy/error/abort 三条测试稳定通过。

### Refactor

1. 只有两个以上测试重复编排模型脚本时才抽 `ScriptedModel`。
2. 只有多个测试重复建 conversation/run fixture 时才抽 builder。
3. fake 不得复制 production service 的逻辑，否则会“实现和测试一起错”。

## 7. 测试矩阵

| 层级 | 场景 | 关键输入 | 关键断言 |
| --- | --- | --- | --- |
| unit | event mapper | 每种 `AgentRuntimeEvent` | 外部 event 字段与 type 正确 |
| unit | context builder | 两条 history | system 与历史顺序稳定 |
| service | run recorder success | start/complete | run 与 steps 全部终态 |
| service | run recorder fail | active step | 当前 step 有错误，其余未完成 step 收口 |
| runtime | happy | `A`,`B` | 事件为 start,delta,delta,done；content=AB |
| runtime | error | `A`, throw | 无 done；Message/Run 为 FAILED |
| runtime | abort | `A`, wait | 无 done/error；Message/Run 为 ABORTED |
| contract | message transaction | message create | Conversation.updatedAt 被 touch |
| contract | history order | 倒序 DB 结果 | 传给 builder 前恢复正序 |
| static | union exhaustive | 新事件 variant | mapper 编译失败提醒补分支 |

## 8. 验收证据

本阶段完成必须保留下列证据，而不是只说“测试能跑”：

- [ ] 测试运行器选择及理由。
- [ ] 根级与 API 包级 test 命令及成功输出。
- [ ] 一个纯函数测试文件路径。
- [ ] scripted fake model 文件路径及支持的动作清单。
- [ ] happy/error/abort 三条 runtime 测试名称。
- [ ] 每条 runtime 测试读取到的 Message/Run/Step 终态摘要。
- [ ] 默认测试中没有真实模型网络调用的证明；任何 live smoke 都有独立命令、显式环境开关和 secret-safe 日志。
- [ ] 原有 `typecheck`、`lint` 和 `git diff --check` 结果。
- [ ] 已知未覆盖风险，例如真实 Prisma transaction 或真实 SDK abort 差异。

退出标准：上述证据全部可复现，且 Phase 01 可以直接复用 fake 来表达结构化 provider event。

## 9. 非目标

- 不实现 ToolDefinition、ToolRegistry 或 Tool loop。
- 不为了测试而重写整个 `AgentRuntimeService`。
- 不引入 Docker 化测试平台、Kafka、Temporal 或 workflow engine。
- 不追求 100% 行覆盖率；优先覆盖状态不变量和错误路径。
- 不使用真实 API Key 做默认测试。
- 不把每个 Prisma getter/setter 都 mock 一遍。
- 不修改前端 UI。

## 10. 源码路径

### 当前项目

- `package.json`
- `apps/api/package.json`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`
- `apps/api/src/llm/llm.service.ts`
- `apps/api/src/seo/seo-chat-stream-event.mapper.ts`
- `prisma/schema.prisma`

### Codex 启发

- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/test_codex.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/responses.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/common/streaming_sse.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/suite/tool_harness.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/tests/suite/abort_tasks.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/registry_tests.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/router_tests.rs`

学习重点是“可编排 provider 响应 + 对外部请求做捕获 + 对状态做断言”，不复制 Rust test harness 的规模。

## 11. 复盘问题

1. 为什么 typecheck 通过不能证明 abort 后没有残留 RUNNING step？
2. fake model 应模拟 provider chunk，还是模拟项目自有 model event？Phase 00 和 Phase 01 的答案为何不同？
3. 哪条测试最能保护阶段 4 的价值？
4. 测试读取最终数据库状态与只检查 mock 调用次数有什么差别？
5. 如果测试必须访问私有方法，是否说明职责边界需要调整？
6. 哪些测试可以纯内存，哪些必须经过 Prisma？
7. 为什么固定 ID 和可控时钟能提升调试效率？
8. 当 Phase 03 加入第二次 sampling 时，当前 fake 还缺什么？
