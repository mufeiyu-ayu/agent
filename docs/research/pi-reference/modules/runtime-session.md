# Pi 运行内核、会话与持久化研究

> 基线：`/Users/ayu/Learn/pi`，HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`，2026-09-15 静态源码研究。本文记录实现，不把同目录设计稿当作已交付能力。范围及核实强度见 [coverage](../coverage.md)。本次没有调用真实模型、执行 Pi 工具或运行测试。

## 1. 先认清两个运行内核

这个快照同时存在 `Agent` 和 durable `AgentHarness`。它们有共同类型与相似工具循环，但运行路径不同，不能合并成一个架构图。

| 对象 | 实际职责 | 入口 |
| --- | --- | --- |
| `Agent` | 内存消息、单次运行、steering/follow-up 队列、事件；持久化由宿主承担 | [agent.ts:173](/Users/ayu/Learn/pi/packages/agent/src/agent.ts:173) |
| `runAgentLoop` / `runAgentLoopContinue` | 普通异步循环：模型→完整工具批→下一轮；没有 durable operation journal | [agent-loop.ts:96](/Users/ayu/Learn/pi/packages/agent/src/agent-loop.ts:96) |
| `AgentHarness` | 管理一个 Session 内命名 Lane，提供 hooks/events/global config；自身不是 Lane | [runtime/harness.ts:29](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/harness.ts:29) |
| `AgentLane` / `Lane` | 某条 Branch 的执行者：接纳操作、驱动、取消、队列、配置、快照 | [runtime/lane.ts:221](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:221) |
| `Session` / `Branch` | 数据与写入屏障 / 命名会话树指针；不调用模型 | [session/types.ts:530](/Users/ayu/Learn/pi/packages/agent/src/harness/session/types.ts:530) |

普通 coding-agent 与实验 worker 对入口的选择必须到调用方核实。新内核直接被 [experimental/mini/worker/run.ts:66](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/worker/run.ts:66) 和 [experimental/session-worker.ts:834](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:834) 创建；这不证明所有 Pi CLI 会话都用新内核。

### 文件夹组织给我们的启发

```text
packages/agent/src/
├── agent.ts / agent-loop.ts / types.ts  普通内存运行内核与共享 DTO
├── proxy.ts / stream-fn.ts            远端模型流适配 / 注入默认模型流
├── harness/
│   ├── agent-harness.ts               对外 API、事件和 hook 类型
│   ├── runtime/
│   │   ├── harness.ts / lane.ts       宿主与 Lane 生命周期、写入发布
│   │   ├── drive.ts                   13 个 durable 状态的显式分派
│   │   ├── drive/                    模型、工具、摘要、重试、终态的过程函数
│   │   ├── restore.ts                只恢复状态，不执行副作用
│   │   ├── progress.ts               模型帧 / 工具 checkpoint 持久化
│   │   └── transcript.ts / reducer.ts 数据投影 / 消费端快照 reducer
│   ├── execution/                    一次模型或工具调用、effect gate
│   ├── session/                      数据契约、Session、Memory、JSONL、fork
│   ├── tools/ / env/                  工具语义 / Node OS 能力适配
│   ├── compaction/                    摘要准备和生成，独立于驱动状态机
│   └── hooks.ts / events.ts / utils/  扩展点、观察、输出限制
└── search/index.ts                    只有搜索接口，无实现
packages/session-backends/sqlite-node/src/
├── index.ts                          node:sqlite 同步驱动适配
└── sqlite/
    ├── repo.ts / session.ts           文件/容器生命周期、打开句柄
    ├── storage.ts                    单次数据库事务
    ├── session/                      entries / values / usage / stats / branch index
    └── migrations/001_initial.sql    当前唯一初始化 schema
```

最值得学的是按“谁拥有数据、谁执行 effect、谁发布结果”拆文件，不是机械复制文件夹。Pi 的 `lane.ts` 本身约 2,000 行、`drive/structural.ts` 约 1,200 行：它没有把“文件短”当作设计正确性的证明。普通 DTO 与 Harness DTO 仍有耦合，也不是可直接照搬的最终目录。

## 2. 普通 Agent：读懂最小闭环

调用链为 `Agent.prompt → runPromptMessages → runWithLifecycle → runAgentLoop → runLoop → streamAssistantResponse → streamFunction → tool batch → turn_end → queue drain`。`runLoop` 外层只负责 follow-up，内层负责工具连续轮次与 steering。`prepareNextTurn` 在上一轮完成且下一轮确定继续时才调用；`shouldStopAfterTurn` 可以先于队列消费结束运行。

核心位置：[runLoop:156](/Users/ayu/Learn/pi/packages/agent/src/agent-loop.ts:156)、[streamAssistantResponse:279](/Users/ayu/Learn/pi/packages/agent/src/agent-loop.ts:279)、[executeToolCalls:409](/Users/ayu/Learn/pi/packages/agent/src/agent-loop.ts:409)。

- `AgentMessage[]` 在模型边界先 `transformContext`，再 `convertToLlm`，才成为 provider `Message[]`；扩展消息不必挤进供应商类型。
- 默认工具并行；普通 loop 的某一个工具声明 `executionMode: "sequential"` 会把整个批次改为串行。并行模式先逐个 preflight，随后并发 effect，最后按模型原始顺序发布工具消息。
- 模型响应为 `length` 时，即使截断 JSON 能勉强解析也不执行其中工具调用，给模型错误结果以便重发完整参数。
- `terminate` 不是任一工具为真即停；所有已最终处理的工具结果都为真才结束该批后的采样。
- `Agent.subscribe` 的 promise 按注册顺序等待；`agent_end` 已发出不代表 idle，监听者全部结束后才 `finishRun`。这是普通内核的运行契约，不能当成单纯 UI 事件。
- `streamProxy` 只把模型请求送到 `/api/stream` 并重建轻量 SSE delta。它不是云端持久运行或安全工具执行方案；其中没有 Session/Lane 状态与恢复机制。见 [proxy.ts:120](/Users/ayu/Learn/pi/packages/agent/src/proxy.ts:120)。

## 3. 新 Harness：数据模型与所有权

### 四个对象不能混用

1. **Session** 是存储容器：拥有 entry 树、values/lists、usage、ID 生成器和一条串行 mutation line。
2. **Branch** 是命名的 `branch.tip`，可以只存数据，不附带 Agent 配置或运行状态。
3. **AgentLane** 是附着在同名 Branch 上的配置及操作状态；一条 Lane 同时只有一个 current operation。
4. **AgentHarness** 管理多个 Lane 和进程级工具/resources/hooks。它不预设 `main`，但 `harness.lane(name)` 对任何尚不存在的名字都会**当场创建**：在 Session 写入屏障内一次 commit 写入 `branch.tip`（可用 `createAt` 指定起点 entry，未知 entry 抛 `UnknownTarget`）、`lane.config`（复制 create 时的 seed 模型/thinkingLevel/activeToolNames）和空闲的 `lane.state`，并发 `lane_created`。已存在的 data-only Branch 被首次 `lane()` 时只补写 config/state，不改 tip。见 [Harness.lane:78](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/harness.ts:78)。

恢复时存在 `branch.tip` 但没有 `lane.config`、`lane.state` 是合法 data-only Branch；只有其中一部分 Lane 值则是 invariant fault。见 [restore.ts:63](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/restore.ts:63)。`restoreLaneState` 还会校验 `op.meta.intent` 与 `op.state.at` 的族匹配（compaction 意图只能停在 `summary.*` 且 boundary 为 finish；导航意图只能停在 `navigation.ready_to_commit` 或 boundary 为 commit_navigation 的 summary 叶子），不匹配同样 fault，见 [stateMatchesIntent:26](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/restore.ts:26)。

### 数据不是一种日志

| 数据 | 寿命、用途 | 云端学习点 |
| --- | --- | --- |
| `Entry` | 不可变会话树节点：message、compaction、branch_summary、custom | 保持可见会话和运行步骤的区别 |
| `pi.branch.tip` | 命名 Branch 当前指针 | navigation 改 tip，不重写旧内容 |
| `pi.lane.config/state` | Lane 模型配置、current operation、inbox、last result 指针 | 可执行状态独立于消息 |
| `pi.op.meta/state` | 当前操作的意图、13 个状态叶子、取消标记 | 断点是 durable state，不是内存 promise |
| `pi.pending.*` | 队列 payload、assistant frames、工具 checkpoint/待 placement 结果 | 暂态可持久，但不等于 transcript |
| `pi.result` | 操作终态不可变观察记录 | settled 后读取结果不重新跑操作 |
| `UsageRow` | 独立 ledger；可有 adjustment，没有必要每条都对应可见 message | 成本账本不由 UI 消息数推算 |

具体地址集中在 [session/values.ts:158](/Users/ayu/Learn/pi/packages/agent/src/harness/session/values.ts:158)，状态联合在 [session/types.ts:316](/Users/ayu/Learn/pi/packages/agent/src/harness/session/types.ts:316)。`pi.op.*` 是当前 journal 值，不是逐事件不可变历史；Memory/SQLite 会覆盖 current value，JSONL 才保留其物理追加记录。不要把它称为完整事件溯源。

### 3.5 宿主怎样使用 Lane：公开 API、错误契约与默认值

正文其余部分讲内部的 `accept/drive/command`，但宿主（experimental worker、mini、未来我们的 NestJS 服务）只会接触 [AgentLane 接口](/Users/ayu/Learn/pi/packages/agent/src/harness/agent-harness.ts:546)。把它按“落到哪一步”分组：

| 宿主调用 | 内部路径 | 语义要点 |
| --- | --- | --- |
| `prompt / skill / promptFromTemplate` | `accept(run) → drive({ waitForRetry: true })` | 一次调用走完接纳与驱动；返回 settled record 或 `SuspendedRun`（deferred）。返回 `LaneBusy` 表示已有 operation，不排队 |
| `accept(request)` + `drive({ operationId, waitForRetry?, pollDeferred? })` | 分开的两步 | 云端 HTTP “接受即返回、worker 再驱动”的原型；`drive` 对已结束 ID 直接返回存储结果，对不匹配 ID 返回 `OperationMismatch` |
| `resume()` | 读 current operation → `drive({ pollDeferred: true, waitForRetry: true })` | **重启后恢复 open operation 的推荐入口**；mini 宿主对 `AgentHarness.create` 返回的每个 `open` 调它。没有 current operation 返回 `NothingToResume` |
| `abort()` / `requestAbort(id)` | 原子写 `cancel_requested` 并撤出 steer/followUp → `drive` 完成 reconcile | `abort()` 会等 reconcile 结束并返回被撤出的队列消息；`requestAbort` 只落标记。源码注释仍写“guarded until M8”，但接口已公开 |
| `steer / followUp / nextRun` | 写 `pi.pending.entry` + inbox | 三种 inbox kind：steer 在下一 checkpoint 注入；followUp 只在没有其他触发时被采用；nextRun 与 write 一样总被下一次 accept 捕获。运行中与空闲时都可入队 |
| `cancelQueued(entryId)` | 删 pending + inbox | 返回 `cancelled / already_consumed / not_found`，已被 accept 消费的条目不能撤回 |
| `appendMessage / appendCustomEntry` | 空闲：直接写 entry 并推 tip；运行中：作为 `write` 入 inbox | 这是“把审批结果、检索结果插进历史”的正确入口，不会插在 tool call 与 result 之间 |
| `navigateTree / compact` | `accept(navigation|compaction) → drive`，成功后自动 `accept({prompt:""})` 尝试续跑 | 续跑只在 inbox 有可触发内容时发生，否则返回 `InvalidMessage(empty)` 被吞掉 |
| `waitForIdle / runWhenIdle` | 观察 `state.operation` 与 `activeDrive` | `runWhenIdle` 用 `idleOwner` 独占 command 线，回调期间新的 accept 会等待 |
| `watch()` | 快照 + 缓冲事件 | 见 §9 |

**错误契约**：所有公开操作返回 `Result<ok|err>`，错误是 [TaggedError](/Users/ayu/Learn/pi/packages/agent/src/harness/result.ts:28) 子类（`LaneBusy / OperationMismatch / NoActiveOperation / NothingToResume / NothingToCompact / InvalidMessage / InvalidNavigation / UnknownSkill / UnknownTemplate / UnknownTarget / Closed`），带 `_tag` 与 `toJSON()`，可直接序列化到 RPC/HTTP。只有 `HarnessFault`（存储/invariant 故障）和 `HarnessClosed` 以异常抛出。experimental 的 [AgentController](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services/agent-controller-provider.ts:91) 就是把 `_tag` 映射成 snake_case 错误码给客户端。

**Context 传播**：每个方法尾参 [Context](/Users/ayu/Learn/pi/packages/agent/src/harness/context.ts:1) 来自 chord，携带 `abortSignal` 与 telemetry parent；用 `withAbortSignal / withCancel / withoutAbortSignal / awaitWithContext` 派生，不用 AsyncLocalStorage。`awaitWithContext` 只取消等待者，不取消底层 Promise，这是 §6 “观察者断开不杀 run”的实现基础。

**默认值**（云端要显式决定，不要沿用）：[DEFAULT_RETRY_POLICY](/Users/ayu/Learn/pi/packages/agent/src/harness/config.ts:4) `maxRetries: 3, baseDelayMs: 1000`，归一化为 `maxAttempts = maxRetries + 1`；Harness 的 `steeringMode / followUpMode` 默认 **`"all"`**（[harness.ts:66](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/harness.ts:66)），而旧 `Agent` 默认 **`"one-at-a-time"`**（[agent.ts:231](/Users/ayu/Learn/pi/packages/agent/src/agent.ts:231)），两代内核队列语义不同；`toolExecution` 两代都默认 `parallel`。`selectAcceptedInbox` 在 one-at-a-time 下每次 accept 只取第一条 steer/followUp，其余留在 inbox。

## 4. 一次带工具的运行：完整链路

### 4.1 附着与接纳分开

`AgentHarness.create` 读取所有配置完整的 Lane，返回 `{ harness, open }`。它不恢复网络请求、不启动工具、不运行 hook、不启动 timer。宿主看到 open operation 后，自己决定何时驱动。见 [createAgentHarness:375](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/harness.ts:375)。

`lane.accept` 只接纳操作。prompt/skill/template 先规范化，拒绝 pending assistant；串行写入区内检查 busy，选择 inbox，连接 entry，**同一次 commit** 写 prompt entries、消费 pending、branch tip、op meta/state、lane state，然后返回 admission。见 [acceptRun:498](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:498)。

`operationId` 可以由调用方指定，但这不是自动的“重复请求幂等键”：`acceptRun` 不先查同 ID 已有结果并返回。云端重试 POST 需要我们另外设计幂等接纳规则，不可直接以相同 ID 重发假定安全。

### 4.2 Drive 才持有执行权

`lane.drive({ operationId })` 在 mutation line 内安装唯一进程内 `Drive`；同一 operation 的其他调用观察同一 completion，已结束的 ID 可返回存储结果。`Drive` 捕获自己的 Gate、retry 等待策略与 poll permit。见 [Lane.drive:921](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:921)。

关键原文：[runtime/types.ts:100](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/types.ts:100)

```ts
this.context = withoutAbortSignal(context);
this.waitForRetry = options.waitForRetry ?? false;
this.deferredPermits = options.pollDeferred === true ? 1 : 0;
```

- 第一行断开“调用者不再等”和“后台操作被取消”的关系；观察者自己的 `awaitWithContext` 仍可以退出等待。
- 第二行允许宿主拿到 durable `waiting/retry/notBefore` 后自行调度，不必一直占据请求。
- 第三行一次 Drive 最多获得一次显式 deferred poll 许可；它不是隐式轮询 daemon。

### 4.3 驱动是显式状态表

[drive.ts:29](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive.ts:29) 使用一个 `for (;;)` 和 `switch (state.at)`，没有 workflow DSL：

| 状态 | 执行职责 |
| --- | --- |
| `starting` | `before_run` 可注入消息，注入落库后进入 checkpoint |
| `checkpoint` | 消费 write/steer、判断 follow-up、阈值 compaction、结束或准备下一轮 |
| `assistant.ready` | 读有效上下文、解析配置、写 effect intent，再调用模型 |
| `assistant.effect_pending` | 重启后发现孤儿请求，按已提交帧收口为 interrupted |
| `assistant.retry_wait` | 到 `notBefore` 后准备新的编号尝试，或返回 waiting |
| `tools` | 工具子状态机执行、恢复、stage、按原顺序 placement |
| `deferred.suspended` / `deferred.effect_pending` | 等待 / 显式 poll 或恢复未知 poll |
| `summary.deciding/ready/effect_pending/retry_wait` | compaction/navigation 摘要的决定、执行、恢复和重试 |
| `navigation.ready_to_commit` | 不做摘要的导航，原子改 tip 并终结 |

每个普通过程必须改变状态对象或返回 waiting/settled，否则 dispatcher 抛“不推进” invariant。取消是与这 13 个叶子正交的 `control.status`，优先进入 reconcile；不是再复制一份 cancelled 状态树。

### 4.4 提交、内存、事件的先后

关键原文：[Lane.command:352](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:352)

```ts
const commit = await mutator.commit(decision.writes, context);
this.state = decision.next;
this.signalStateChange();
const result = decision.materialize(commit);
```

这里集中保证“成功提交→更新内存投影→构造返回值”，随后同步绑定事件接收者，并在退出 Session 写入屏障后等待投递。`materialize` 必须同步；代码主动拒绝 thenable。planner 只能计算/读取，不得调用模型、工具、hook、timer 或事件处理器。见 [Lane.command:328](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:328)。

`StorageBackedSession.beginMutation/mutate` 是 read-modify-write 屏障，一个 capability 只允许零或一次 commit attempt，结束后失效。callback 内再调用 public Session writer 并 await 会排到自己后面而死锁；必须用传入的 mutator。见 [session.ts:95](/Users/ayu/Learn/pi/packages/agent/src/harness/session/session.ts:95)、[session/types.ts:546](/Users/ayu/Learn/pi/packages/agent/src/harness/session/types.ts:546)。

### 4.5 模型边界与输出

实际链路：`readBoundedContext → resolve model/tools/systemPrompt → before_request → publishGenerationIntent → streamHarnessAssistant → transform_context → toProviderMessages → Gate.admit → Models.streamSimple`。模型 provider event 由 `consumeAssistantStream` 消费，编码帧异步排队到 pending list，同时发 live message 事件；流结束先 drain progress，再 after_response，随后 `publishResponse` 原子写最终 Entry、UsageRow、Branch tip 与下一状态。见 [generation.ts:132](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/generation.ts:132)、[execution/assistant.ts:136](/Users/ayu/Learn/pi/packages/agent/src/harness/execution/assistant.ts:136)、[response.ts:182](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/response.ts:182)。

**`message_end` 不是入库成功。** `openAssistantResponse.observer.end` 在 `publishResponse` 之前发出；`entry_added` 才由成功 commit 生成。帧也不会让 provider 循环逐帧等待数据库，但 drain 会等待已经排队的写入。因此“前端已看见的最新文字”可能比 crash 后恢复出的 durable prefix 更新。

**Pi 不直接满足本项目 `model-visible ⟺ logged` 不变量。** `transform_context`、`toProviderMessages`、动态 systemPrompt 和 `before_payload` 可改变有效请求，它们的最终结果没有在 generation intent 中完整持久化。Pi journal 能重建会话与继续位置，不等价于重建每次精确模型输入。云端必须保留我们的 Context boundary，并记录 effective model request/版本/来源；不可因迁移这套目录而删掉现有记录。

### 4.6 准备结束时，用户又补充了输入

checkpoint 产生 `may_finish` 只是结束候选。`finishRunBoundary()` 采用 `plan → hook → replan → commit`：先读当前上下文，在 Session 写入屏障外等待 `before_run_end`；hook 返回后，再通过 `continueOperation` 进入 mutation line，重新读取和规划 inbox。这样等待 hook 不会堵住新输入，也不会用等待前的决定直接终结运行。

原文条件：[boundary.ts:204](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/boundary.ts:204)

```ts
const hookPlanIsCurrent =
  placement.entries.length === plannedEntryIds.length &&
  placement.entries.every((entry, index) => entry.id === plannedEntryIds[index]);
```

- 重新规划发现新输入可以触发下一轮时，先提交新输入和 `assistant.ready`，继续运行；这条分支早于采用 hook follow-up。
- 没有新输入触发运行，且上述 entry 列表仍与运行 hook 前相同，才允许采用 hook 的 follow-up。过期的 hook 决定不能覆盖更新后的上下文。
- 没有应继续的工作，才在同一次提交中写终态结果、清理 operation/pending 并释放 lane；取消仍由 `continueOperation` 的能力检查拦截。

完整实现：[finishRunBoundary](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/boundary.ts:163)。配套 [竞态测试](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-generation.test.ts:331) 停住 finish hook，插入 steering，再释放 hook，断言继续到 `assistant.ready` 并使用新输入；本研究读取了该断言，未执行该Vitest文件。

云端对应的是“用户在 Agent 收尾时继续补充要求”：异步 hook 之前的判断只能当候选，重新取得写入所有权后仍须复核当前输入。UI显示生成结束、hook返回或一次队列检查，都不能替代最终提交的结束决定。

## 5. 工具调度、checkpoint 与恢复

四步子状态机位于 [session/types.ts:157](/Users/ayu/Learn/pi/packages/agent/src/harness/session/types.ts:157)：

```text
planned
  → prepareArguments → validateToolArguments → before_tool → 再验证替换参数
effect_pending（先持久化有效 args、replay policy、reserved resultEntryId）
  → Gate.admit → tool.execute → 可选 checkpoint → after_tool
outcome_ready（暂存完整 ToolResultMessage；可以发 tool_end）
  → 按 assistant content 的 sourceIndex 放置
completed（最终 Entry、UsageRow、tip、状态同事务写入）
```

核对入口：[execution/tools.ts:78](/Users/ayu/Learn/pi/packages/agent/src/harness/execution/tools.ts:78)、[publishToolIntent:187](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/tools.ts:187)、[publishToolOutcome:229](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/tools.ts:229)、[materializeReady:280](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/tool-placement.ts:280)。

- 每个调用以 assistant **完整 content 数组**下标为 sourceIndex，不是筛选后第几个 toolCall。
- parallel 执行可乱序完成，`outcome_ready` 先保存后来的结果；只有从首个未 completed 调用开始的连续 ready 前缀才能进入 transcript。先完成的工具一直显示 settled，直到 placement 移除。这样显示速度与模型输入顺序各有契约。
- `toolExecution` 在 run settings 捕获，默认 parallel。新 Harness 的 `runTools` 根据批设置分派；不要把普通 loop 的 `executionMode` 单工具覆盖规则推断到这里。
- `before_tool` 抛错会 block；替换 args 会再做 schema 验证。`prepareArguments` 可把字符串化参数/旧格式规范化，但不是放松信任边界。
- 工具 `onUpdate` 默认只是 live 快照，只有 `{ checkpoint: true }` 才请求持久化 recovery checkpoint。内置 bash 约每 2 秒且内容变化时 checkpoint；不是每个 UI update 都入库。

### 不重跑未知副作用

关键原文：[recoverToolInvocation:527](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/tools.ts:527)

```ts
if (!cancelled && call.replay === "safe" && tool?.replay === "safe") {
  const args = await clearReplayCheckpoint(lane, drive, run.batch, call, toolCall);
  const cleared: ClearedToolCall<TContext> = { toolCall, tool, args };
```

- 持久记录和当前工具实现必须都认为 safe，才允许重新执行；缺工具、降级为 never、已取消均不满足。
- 重放使用已保存的有效参数与相同 invocationId，不再重跑 before_tool/preparation 来改变意图。
- 其他情况用最后 durable checkpoint 加“external outcome is unknown”合成错误结果，绝不声称原 effect 未发生。
- `invocation.getMemo/setMemo` 保存一次调用的幂等键或远端 job ID；执行结束 capability 失效，outcome_ready 提交会删除 memo。这不是 exactly-once 保证；远端系统仍须幂等/可查询。
- 内置 read/write/edit/bash 没有设置 replay，因此默认 `never`；“只读工具看起来可重放”不等于源码已声明 safe。

## 6. 取消、关停、故障、恢复分别是什么

| 事件 | 实现行为 | 不应声称 |
| --- | --- | --- |
| 观察者 signal abort | `awaitWithContext` 结束当前等待，Drive 的 context 已剥离此 signal | 用户断连会自动杀掉 run |
| `requestAbort(operationId)` | 先关闭新 effect admission；原子存 cancel_requested、撤出 steer/follow-up；成功后 signal 已接纳 effect。已在 `AgentLane` 接口公开，源码内部注释“guarded until M8”已过期 | 发送 signal 本身就是 durable cancel |
| Gate abort 与新 effect 竞争 | 同步 `admit` 和 `beginAbort` 定义谁先获得执行资格 | 任意一个异步检查足以防竞态 |
| `Harness.close` | 封 Lane/Gate/hook/event、关闭 Session；保留未终结 operation 供下次恢复 | close 等于生成 aborted terminal |
| 存储或 invariant fault | fault 全 Harness，封住所有 Lane；需要重新打开恢复 | DB 写失败可当普通 tool error 继续 |
| 普通模型 orphan | 以 committed frames 合成 error，usage=0，外部结果未知；按剩余 retry budget 可进入新的尝试 | 网络请求无成本、原请求必定没完成，或永不再调模型 |
| deferred orphan | 有显式 permit 才以同一远端 handle 查询，新响应/usage ID；每 pass 一次 | 恢复会偷偷不断 poll |
| 摘要 orphan | 该编号 attempt 消耗掉；新的 attempt 重新做摘要，已记录的 nested usage 保留 | 从摘要中间的任意 await 原地继续 |

源码：[effect-gate.ts:31](/Users/ayu/Learn/pi/packages/agent/src/harness/execution/effect-gate.ts:31)、[requestOperationAbort:1006](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:1006)、[recovery.ts:44](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/recovery.ts:44)、[deferred.ts:231](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/deferred.ts:231)、[structural.ts:1077](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/structural.ts:1077)。

取消时 `continueOperation` 不允许继续新工作，`settleOperation` 仍可收回已接纳 effect 的结果。取消后迟到模型结果被规范为 aborted；工具结果仍要落为工具消息以闭合原 tool call。deferred 的远端 cancel 是 best-effort，失败也继续本地 reconcile。只有最终事务写入 `pi.result`、清理 op/pending，并把 lane current 置空，才是 durable terminal。

## 7. 上下文与 compaction

`readBoundedEntries` 从 tip 向祖先扫描到最新 compaction，翻转后交给 `buildSessionContext`。普通 message 除 error/aborted/deferred assistant 外进入上下文；compaction 变为 summary message 加 retainedTail；branch summary 变为 summary message；custom entry 默认不进入模型，只有注册 projector 才产生消息。见 [transcript.ts:50](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/transcript.ts:50)、[session/context.ts:47](/Users/ayu/Learn/pi/packages/agent/src/harness/session/context.ts:47)。

### 算法取舍

- 优先采用最近一次有效 assistant usage，加估算的尾部消息；没有 usage 才全量字符估算。字符/4、图片固定估计都只是 heuristic，不是精确 tokenizer。见 [estimateContextTokens:215](/Users/ayu/Learn/pi/packages/agent/src/harness/compaction/compaction.ts:215)。
- 默认 `reserveTokens=16384`、`keepRecentTokens=20000`。触发公式为 contextTokens 大于 contextWindow 减 reserve；这些是 Pi 默认值，不能直接替换我们实际模型预算。
- `findCutPoint` 不把 toolResult 当切点，避免保留孤立工具结果；过长 turn 可拆成历史摘要、turn prefix 摘要和 retained suffix。多次 compaction 会把前一 retainedTail 转为虚拟 entries 重新选切点。见 [findCutPoint:370](/Users/ayu/Learn/pi/packages/agent/src/harness/compaction/compaction.ts:370)、[prepareCompaction:634](/Users/ayu/Learn/pi/packages/agent/src/harness/compaction/compaction.ts:634)。
- 摘要采用固定的目标/约束/进展/决策/下一步/关键上下文格式；文件路径和符号要求精确保留。工具结果被摘要序列化时截到 2,000 字符。文件操作表由 assistant tool call 的 args 提取，描述的是请求过的操作，不能直接当作 OS 已成功修改的事实。
- 摘要作为新 immutable compaction entry 存储 summary + retainedTail，旧树不删除。模型上下文压缩不等于 JSONL 文件回收。
- durable structural driver 把 preparation 先存起来，每个 nested summary request 有独立 usage intent/row；阈值摘要可 decline 后继续，overflow 摘要 decline 会 fail；overflow recovery 用标记限制循环。见 [structural.ts:727](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/structural.ts:727)。

## 8. 三种 backend 与 fork

### 8.1 公共契约

`Storage.commit(Write[])` 覆盖 entry、value set/delete、list append/delete、usage。每条 write 获得全 Session 单调 seq；同事务共用 timestamp，并返回提交后 stats。`validateCommittedWrites` 检查 entry/usage 共用 ID 空间和“parent 必须已存在或在本事务前面”。Memory/JSONL 在应用前验证，SQLite 用 PK/trigger 保证。见 [commit.ts:90](/Users/ayu/Learn/pi/packages/agent/src/harness/session/commit.ts:90)。

`MutationLine` 是一条 promise 尾链，覆盖完整读取、决策、写入、内存发布过程，不只序列化 append。它是进程内协调，不是跨机器锁。多个 Lane 共享同一 Session 写入屏障，模型/工具 effect 在屏障外执行。

### 8.2 Backend 对比

| Backend | 已实现 | 边界 |
| --- | --- | --- |
| Memory | Map/数组物化所有 entry/value/list/usage；repo 关闭 facade 后可重新打开同一底层会话 | 非进程重启持久化；不是云端数据库模板 |
| JSONL v4 | header 后一行一个 transaction（单 write 或数组）；先 append 成功再更新内存；丢弃未换行末尾；格式 3 按需升级 | open v4 读完整文件并重放到内存；无跨进程所有权；无普通 dead-byte snapshot compaction |
| SQLite Node | 参数化 SQL、`BEGIN IMMEDIATE` 单次同步事务；按需查询、usage/stats 同事务；每 Session 独立文件或可选共享容器 | `DatabaseSync` 同步阻塞；没有 storage lease/fence/heartbeat；宿主负责唯一 writer |

源码：[InMemoryStorageState:72](/Users/ayu/Learn/pi/packages/agent/src/harness/session/in-memory-storage-state.ts:72)、[JsonlStorage:85](/Users/ayu/Learn/pi/packages/agent/src/harness/session/jsonl/storage.ts:85)、[SQLite applyCommit:163](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/storage.ts:163)、[Node transaction:78](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/index.ts:78)。

JSONL 的 `publishFileAtomically` 用 `.tmp` 完整写入后 rename，用于创建、torn-tail 修复、v3 升级、fork；源码未调用 fsync。因此这里的 atomic publication/进程恢复证据不能提升为断电级 durability 证明。JSONL v3 open 先只读 normalize，首次非空 commit 才以 v4 完整替换，导入 usage 只加一次 adjustment。见 [jsonl/io.ts:81](/Users/ayu/Learn/pi/packages/agent/src/harness/session/jsonl/io.ts:81)、[legacy-v3.ts:563](/Users/ayu/Learn/pi/packages/agent/src/harness/session/jsonl/legacy-v3.ts:563)。

SQLite 权威表是 `entries/scalar_values/list_values/usage_ledger`；`sessions` 内 stats 和 `branch_entries/branch_meta` 为事务内维护的投影。分支 divergence 复制最近 compaction 之后的祖先片段；没有 compaction 时可能复制整个历史，不是恒定成本。见 [schema](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql:1)、[createDivergentBranchForEntry](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/session/branch-entries.ts:152)。

SQLite repo 支持 no-create open、只读 list、safe filename、canonical physical identity、共享容器单 Session 删除、WAL/SHM 清理、all-settled close。独立 repo 对 live source fork 使用只读连接与一个 WAL read transaction；同 repo source 则在其 commit queue 抓快照。它保证这次复制的读边界，不替宿主实现分布式运行所有权。见 [repo.ts:122](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/repo.ts:122)。

### 8.3 Fork 是新会话，不是复制正在执行的任务

公共策略见 [fork-policy.ts:40](/Users/ayu/Learn/pi/packages/agent/src/harness/session/fork-policy.ts:40)：

- branch scope 要求显式 Branch 名和完整 AgentLane，选中的 entry 必须在当前 tip 祖先链上；可选 at/before。
- tree scope 保留全部树与 data-only Branch；已配置 Lane 保留配置但重置为空闲、空 inbox。
- op、pending、result 与 usage ledger 不复制；未知 `pi.*` 保留域拒绝，防止新内部状态被意外携带。
- Memory 和 JSONL tree fork 保留应用自有 scalar/list；branch fork 不带应用状态。
- JSONL 已采用两遍：第一遍索引 parent/seq/current state，第二遍流式写选中 payload，捕获 nextSeq 排除后来 append；复制期间源文件不能被替换。见 [runJsonlFork:295](/Users/ayu/Learn/pi/packages/agent/src/harness/session/jsonl/fork.ts:295)。
- **SQLite 仍是快照实现**，`createForkSnapshot` 的输入只有 entries/scalarValues，没有 list；因此不能声称 SQLite tree fork 已实现应用 list 完整复制和有界内存流式复制。此差异与源码 `TODO(WP08)` 一致。见 [sqlite/repo.ts:104](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/repo.ts:104)、[session/fork.ts:29](/Users/ayu/Learn/pi/packages/agent/src/harness/session/fork.ts:29)。

## 9. 观察、hooks 与宿主能力

### Lane watch 是“快照 + 后续事件”

`lane.watch` 在 Session mutation line 内安装 watcher 并抓快照，期间产生的事件先缓冲；`start` 只能一次，随后按序投递。`resnapshot` 用 delivery-tail barrier 与 epoch 丢弃旧快照前事件、暂存边界后事件。navigation_end 不能靠一个 tip 字段重建 branch，因此 reducer 返回 `rebase`，消费者必须重新抓快照。见 [Lane.watch:1705](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/lane.ts:1705)、[events.ts:165](/Users/ayu/Learn/pi/packages/agent/src/harness/events.ts:165)、[reducer.ts:220](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/reducer.ts:220)。

普通 events handler 的异常被隔离并发 `handler_error`；但慢 handler 仍影响被 await 的投递延迟。UI watch 和普通 event subscriber 的运行成本不同，不能把所有观察都说成零成本。生产 schema 声明大量 spans，实际 agent 源码调用 `startHarnessSpan` 的位置只有 before_tool/after_tool 的注册 handler；声明 schema 不是全链路 telemetry 已接入。

### Hooks 的失败策略按职责定

| Hook | 聚合与失败行为 |
| --- | --- |
| `before_run` | 顺序追加注入消息，异常报告后继续 |
| `before_run_end` | 顺序执行，最后一个已定义的followUp胜出，handler异常报告后继续；是否采用仍由finish boundary重检查inbox与计划有效性 |
| `transform_context`、`before_request`、`before_payload`、`after_response` | 前一 handler 的结果传给后一 handler；异常保留当前值继续 |
| `before_tool` | 顺序改 args，首个 block 停止；异常转换成 block |
| `after_tool` | 字段级 patch，后者覆盖同字段；异常报告继续 |
| `before_compaction/navigation` | 首个 decline 或自定义结果胜出；同时两者为非法，报告后继续 |
| `before_drive` | fail-closed，异常向上传播 |

见 [hooks.ts:89](/Users/ayu/Learn/pi/packages/agent/src/harness/hooks.ts:89)。Pi 没有因为都是插件就给所有 hook 同一“吞错/抛错”规则。云端审批不能仅注册一个可失败开放的普通 context hook；应是持久化、可审计的 effect admission 决策。

### Node 环境不是 sandbox

`ExecutionEnv = FileSystem + Shell`，内置工具只依赖这份 capability；Node 实现把路径、文件、shell、跨平台 kill、输出 capture 隔离在一处。它允许绝对路径、父目录和 symlink 解析，默认继承进程环境；没有租户 root confinement 或 OS sandbox。见 [harness/types.ts:275](/Users/ayu/Learn/pi/packages/agent/src/harness/types.ts:275)、[env/nodejs.ts:438](/Users/ayu/Learn/pi/packages/agent/src/harness/env/nodejs.ts:438)。

工具处理风格很具体：read 限行/字节并告诉模型下一 offset；edit 在同一原文匹配全部不重叠替换，保留 BOM/换行和未修改行；write/edit 按同 ExecutionEnv + canonical path 排队；bash 输出从源头受限、超限 spill、带 backpressure，避免 UI 收到完整无界字符串。`AdaptivePublisher` 只更新最新 view，按字节大小控制发送节奏。这些边界比复制工具描述更值得学。见 [tools/edit.ts:104](/Users/ayu/Learn/pi/packages/agent/src/harness/tools/edit.ts:104)、[file-mutation-queue.ts:30](/Users/ayu/Learn/pi/packages/agent/src/harness/tools/file-mutation-queue.ts:30)、[output-capture.ts:26](/Users/ayu/Learn/pi/packages/agent/src/harness/utils/output-capture.ts:26)。

skills/templates 被建模为宿主加载的资源：Skill 递归查找、尊重 ignore、记录 diagnostics；template 目录只读直接 `.md` 子项；source-tag 由应用定义，内核不解释。`formatSkillsForSystemPrompt` 只给可见技能名、描述、位置，内容按需读取；显式 `lane.skill` 则将完整 skill 内容包成 user message 接纳。见 [skills.ts:51](/Users/ayu/Learn/pi/packages/agent/src/harness/skills.ts:51)、[prompt-templates.ts:31](/Users/ayu/Learn/pi/packages/agent/src/harness/prompt-templates.ts:31)。

## 10. 设计文档与代码存在的差距

| 容易误读的材料 | 固定快照的源码事实 |
| --- | --- |
| `harness.md` 的 Session-wide watch | `Harness.watchSession()` 仍抛 `SliceNotImplemented` |
| `docs/telemetry.md` 的 Context/span 设计 | 该文档自己说明大多数 runtime span 未实现；实际只有工具 hook 建 span，是 §9 telemetry 结论的一手依据 |
| JSONL snapshot compaction 设计 | 有 atomic file publisher，但没有普通 current-state 重写、dead-byte 触发和回收 |
| 原始 RemoteSession 传输要求 | 本研究的 Session/Storage 都是进程本地；不要从概念图推定 RPC 已传输了 mutation capability，参照协议模块另证 |
| 全套 telemetry schema | agent 内只有工具 hook handler 真实创建 span；其他 vocabulary 不等于观测齐全 |
| `search/index.ts` | 27 行接口，无 search engine、FTS index 或同步实现 |
| format 4 schema evolution | SQLite 只有 `001_initial.sql`；Memory current-only，JSONL/SQLite 拒绝不支持版本，没有迁移链 |
| WP08 与旧 roadmap | HEAD 已有 named branch 语义和 JSONL 两遍流复制，但 SQLite 仍快照、漏应用 list；不能照抄旧 roadmap 的“全部 backend 都旧式 fork” |
| `OperationStatus = running/open/aborting` | inspection/watch 当前实际构造 open/aborting；不能凭 union 推断 active drive 会发布 running |
| 插件/mobile handoff 中 scopes、沙箱、assistant delta 的示例代码 | 属 docs 下设计/实验，不是 `src/harness` 已接入的实现 |

核查设计入口：[post-wp05-roadmap.md:19](/Users/ayu/Learn/pi/packages/agent/docs/post-wp05-roadmap.md:19)、[harness.md:1251](/Users/ayu/Learn/pi/packages/agent/docs/harness.md:1251)、[harness.md:1282](/Users/ayu/Learn/pi/packages/agent/docs/harness.md:1282)。旧审计 baseline 早于本文 HEAD，逐项以本文源码比较为准。

## 11. 后续 AI 查阅顺序

每次选一条实际路径，读完“输入→决策→副作用→落库→下一步”，不按文件从上到下背 API。

1. 普通 `runLoop` 的一次文本回答和一次工具轮，确定最小循环。
2. Session/Branch/Lane/Harness 与 `Entry`、current state、pending、result 的区别。
3. `acceptRun → Lane.command → Session.mutate → Storage.commit`，画出原子边界。
4. `driveOperation → checkpoint → generation → response`，区分 live output 和 durable facts。
5. 两个工具乱序完成，解释为什么要 `outcome_ready`；再看 safe/never 恢复。
6. request cancellation、durable abort、close、fault 的四个具体场景。
7. compaction 的 retainedTail 和 split turn，再看 structural attempt。
8. 同一 storage conformance 在 Memory/JSONL/SQLite 上成立到什么程度；专门检视未完成的 fork。
9. lane snapshot/reducer/resnapshot，再接协议与 worker 模块。

每段结束要能回答：当前是谁持有控制权；哪些数据已提交；哪个 effect 可能已经发生；进程此刻退出后下一次读取哪个状态；什么证据进入模型。建议从相应测试构造事件顺序，不用真实 provider 验证控制语义。

## 12. 对本项目的建议：学习思想，按痛点重构

### 优先保留与借鉴

- 保留 NestJS/Vue/Prisma/PostgreSQL 的边界和本项目 Context/retrieval/citation 不变量；借鉴 Pi 的 `accept/drive/observe` 分离，让 API 断连与后台运行寿命分别处理。
- 首个可验证云端切片可以只有一个命名主 Lane：请求原子接纳、worker 驱动、可读终态、断开后重连观察。不因 Pi 支持多 Lane 就提前实现多 Agent。
- 在“写操作可能成功但返回没收到”的真实痛点出现时，加入 reserved invocation ID、intent/outcome journal、unknown outcome 与工具自身幂等键。数据库事务只解决本地状态，不替外部服务提供 exactly-once。
- 保持模型请求记录独立且完整，专门补足 Pi 的 request-time transforms 与日志不一致点；检索证据也必须通过现有信任边界。
- 测试最值得直接学的是 GatingStorage/faux provider：人为停在 commit/effect 边界，验证先后两种竞态；不是为了架构图增加一个通用 workflow engine。

### 云端必须由我们补出的责任

1. 宿主的租户授权、单 writer 所有权与租约/fencing：Pi SQLite 明确交给 host，本项目不能以进程内 Map 代替。
2. 持久审批：决定、批准人、有效参数/版本和过期规则必须入库并在 effect gate 前再次验证；Pi before_tool block 只是可扩展位置，不是完整审批系统。
3. 对外重试幂等：接纳 API、worker 重投和外部工具各自的幂等语义分开设计。
4. 安全 ExecutionEnv：目录/网络/凭据隔离与资源限额，不能把 Pi Node shell 放到共享应用进程直接开放。
5. 输出与存储配额：模型流、工具大输出、pending journal、审计记录各有保留策略；Pi 源码的 JSONL 回收和 telemetry 缺口也提醒我们，不应以“有类型/有图”作为实现完成。

这些是学习后的方向草稿，不是新 Active Task，也不改变现有 Issue 的范围或验收状态。
