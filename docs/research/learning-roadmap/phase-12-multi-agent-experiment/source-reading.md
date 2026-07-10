# Phase 12 源码阅读：Codex 子 Agent 控制面与云端实验映射

## 1. 阅读目标

这一阶段只从 Codex 提取 Multi-agent 的结构约束：

- 子 Agent 为什么是独立 Thread？
- spawn 如何维护 parent、depth、agent path、history 与配置继承？
- spawn registry、v2 residency、active execution 三种容量为什么不同，分别在创建/加载/turn 执行前怎样保护？
- send/follow-up/wait/interrupt/list 如何区分通信语义？
- child 完成、失败、卸载、恢复时，控制面如何找到它？
- 哪些能力对当前“一次性 page audit child Run”过重？

源码快照：`/Users/ayu/Desktop/codex@626147f728`。

## 2. 阅读前先固定当前项目结论

当前项目只有：

- 用户可见 `Conversation`。
- 用户可见 `Message`。
- 一次输入触发的 `AgentRun`。
- Run 内部 `AgentStep`。

schema 没有 parent/child、task contract、usage budget、AgentThread 或 mailbox。先写下：

- child 是否需要出现在用户会话列表？默认不需要。
- 一次性 child 是否真的需要长期 Thread？默认不需要。
- 谁生成 task spec，谁校验 resource scope？
- parent 结束时 children 必须处于什么状态？
- 你准备用什么指标证明 Multi-agent 有价值？

读 Codex 后只能修正这些设计，不能直接把 Rust 的 Thread 模型全搬过来。

## 3. 路线 A：AgentControl 是一棵 root-scoped 控制树

### 3.1 源码入口

- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/agent/registry.rs`
- `codex-rs/core/src/agent/status.rs`
- `codex-rs/core/src/agent/control_tests.rs`

### 3.2 需要观察的事实

`AgentControl` 是每个 session 通过 SessionServices 持有的控制面。它在一个 root thread/session tree 内共享：

- session id。
- global ThreadManager 的 weak handle。
- root-scoped AgentRegistry。
- v2 residency 管理。
- execution limiter。
- root/children 共享的 rollout budget。

Weak manager handle 用于避免 `ThreadManagerState -> Thread -> Session -> Services -> ThreadManagerState` 的引用环。这一 Rust 实现细节不需要迁移，但职责提示很重要：控制面负责 agent tree，执行 Thread 负责自己的 runtime。

这里必须避免一个常见误读：registry spawn count、v2 loaded residency、v2 active turn execution 是三类 capacity；共享 rollout budget 是 usage accounting/reminder，不是第四个线程 slot，也不是云端 durable quota reservation。

### 3.3 当前项目翻译

建议把职责分成：

```text
Parent AgentRuntime
  -> ChildTaskPlanner（产出候选 task specs）
  -> ChildTaskPolicy（校验 scope/budget/depth）
  -> AgentRunScheduler（预留并启动 child runs）
  -> AgentRunStore（durable tree/status/results）
  -> ChildResultAggregator
```

不要让 `AgentRuntimeService` 同时充当 registry、scheduler、store、budget 和 aggregator；但也不要在一个实验里建完整通用 control plane。按职责画边界，最小实现可合并相邻 service。

## 4. 路线 B：Spawn、父子关系与 fork history

### 4.1 源码入口

- `codex-rs/core/src/agent/control/spawn.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `codex-rs/core/src/thread_rollout_truncation.rs`
- `codex-rs/core/src/agent/role.rs`

### 4.2 Spawn tool 入口

本地 `multi_agents_v2/spawn.rs` 做了这些事：

1. 严格解析 `message/task_name/agent_type/model/reasoning/service_tier/fork_turns`。
2. `fork_turns` 只接受 `none/all/positive integer`。
3. 计算 child depth。
4. 基于 parent/turn 构建 child config，并应用受控 role/模型 override。
5. 创建带 parent thread/depth/path/role 的 `SessionSource::SubAgent`。
6. 调用 `AgentControl::spawn_agent_with_metadata`。
7. 发出 subagent started event 与 telemetry。

观察重点：模型只提供请求参数，系统生成 canonical agent path、parent id、depth 和实际 config。

### 4.3 `spawn_agent_internal`

阅读顺序：

- 先决定 MultiAgent version，并对 subagent spawn 做 execution-capacity 预检查。
- v2 resident source 预留 residency pending slot；随后始终创建 registry `SpawnReservation`，但 v2 residency 路径给 registry 的 max-thread 参数是 `None`，其容量 gate 由 residency 承担。
- 显式继承 environment 与 exec policy。
- `prepare_thread_spawn` 形成 metadata。
- 按 fork mode 创建 forked thread 或 new thread。
- 成功后 commit reservation；失败靠 guard/drop 释放。
- 提交 initial operation 后发送 started/completion 关联事件。

注意：execution guard 真正围绕 child turn 生命周期取得/释放，不是 spawn 成功后一直占用。云端映射时不要因为 Codex 都返回 `AgentLimitReached` 或共享某个 max 配置，就把不同资源合成一个计数。

云端映射：child slot、budget、scope 和数据库行必须在启动模型前预留/创建；失败不能留下无法解释的“已计数但无 child”或“child 已运行但 DB 不知道”。child READY 行、reservation 与 dispatch outbox 必须同事务，worker 再以 lease 原子 claim READY -> RUNNING。

### 4.4 `keep_forked_rollout_item`

这是最值得细读的函数之一。Full/partial fork 不会盲目复制所有 rollout item：

- 保留 system/developer/user message。
- assistant 只保留 final answer phase。
- 不保留 reasoning、function/tool calls/outputs、inter-agent communication 等大量中间 item。
- 是否保留 TurnContext/WorldState 取决于 full history 与 reference context 语义。

这说明即使 Codex 支持 fork，也会主动过滤历史。当前云端实验应更保守：默认只传 task objective、page reference、tool allowlist、output schema 和必要 domain instructions，不复制 parent transcript。

## 5. 路线 C：并发执行容量与 reservation

### 5.1 源码入口

- `codex-rs/core/src/agent/control/execution.rs`
- `codex-rs/core/src/agent/control/execution_tests.rs`
- `codex-rs/core/src/agent/registry.rs`
- `codex-rs/core/src/rollout_budget.rs`

### 5.2 关键机制

`AgentExecutionLimiter` 用 atomic active counter 与 max threads。`AgentExecutionGuard` 在 Drop 时释放计数。`ensure_execution_capacity_for_op` 只在一个 operation 真正启动 turn 时检查，并避免 active turn 重复计数。

### 5.3 三类 capacity 精确对照

| Capacity | 主要文件/对象 | 计数对象 | 当前快照语义 |
| --- | --- | --- | --- |
| Registry spawn reservation | `agent/registry.rs` 的 `SpawnReservation` | root-scoped 已注册/待注册 child metadata/thread | reserve 失败 Drop 回滚，commit 后直到 registry release；非 v2-residency 路径可在此执行 max 限制 |
| V2 residency | `agent/control/residency.rs` 的 `V2ResidencySlot` | loaded residents + pending load slots | 满时只可卸载 terminal、无 active turn、无 pending mailbox 的 LRU；durable stored thread 仍可后续 reload |
| V2 execution | `agent/control/execution.rs` 的 limiter/guard | 真正 active 的 subagent turns | 会启动 turn 的 op 先 check；guard 在 turn 结束/异常 Drop，follow-up 触发新 turn 也重新受限 |

`RolloutBudget` 另行按 root tree 累计加权 token，并驱动 exhaustion/reminder；它不是 spawn/residency/execution slot，当前项目也不能拿它代替 Phase 10 的数据库 usage ledger 和 hard quota。

阅读问题：

- capacity check 与 guard 获取为什么是不同职责？
- spawn 数量与 active execution 数量是否相同？
- follow-up message 触发新 turn 时为何也要检查 capacity？
- 错误/中断是否都能释放 guard？
- rollout budget 为什么由整棵 tree 共享？

### 5.4 云端映射

不要照搬进程内 AtomicUsize 作为 durable 限额。当前项目至少需要：

- DB canonical child state。
- per-parent/tenant slot reservation。
- worker lease 或 in-process guard。
- terminal/recovery 释放。
- parent total budget reservation。
- READY child + transactional outbox + idempotent lease claim；解决数据库 commit 后进程崩溃导致 enqueue 丢失。

第一版在单实例中可以有内存 semaphore，但它只能是执行优化；数据库状态与预算才是恢复事实。

## 6. 路线 D：Residency、卸载与恢复

### 6.1 源码入口

- `codex-rs/core/src/agent/control/residency.rs`
- `codex-rs/core/src/agent/control/residency_tests.rs`
- `codex-rs/core/src/agent/control/spawn.rs` 的 `ensure_v2_agent_loaded`、resume 方法。
- `codex-rs/thread-store/src/store.rs`。

### 6.2 关键机制

V2 residency：

- 用 pending slot 防止并发 reservation 超容量。
- 容量满时尝试卸载 LRU candidate。
- 只有 completed/errored/interrupted、无 active turn、无 pending mailbox 的 child 才可卸载。
- 卸载前确保 rollout materialized 并 shutdown/wait。
- 后续 message/follow-up 可从持久化 history 重新加载 child。

云端学习点：live worker/process residency 与 durable AgentRun/Thread 是两回事。当前 page audit 实验不需要 resident child；child terminal 后只保留 DB result/steps。只有加入多轮 mailbox/resume 才考虑 internal AgentThread。

## 7. 路线 E：Communication 的不同语义

### 7.1 源码入口

- `codex-rs/core/src/tools/handlers/multi_agents_v2/message_tool.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/followup_task.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/interrupt_agent.rs`

### 7.2 `send_message` 与 `followup_task`

两者共享 parsing/dispatch，但 delivery mode 不同：

- QueueOnly：消息进入 mailbox，不主动启动 turn。
- TriggerTurn：触发目标 agent 新 turn；不能以 root 为 follow-up target。

handler 会：解析 canonical target、确保 agent 已知、必要时 reload、构造带 author/receiver path 的 communication、发送 activity event。

当前实验不需要这套双向通信。父任务只等待 child terminal/result；若实验发现 child 需要澄清输入，应先把任务 contract 改清楚，而不是立即加 mailbox。

### 7.3 `wait_agent`

本地实现等待 input queue activity，有 min/max/default timeout，区分 mailbox、steer、timeout，并发送 waiting begin/end events。学习点：wait 是有期限、可观察的状态，不是无界 await Promise.all。

云端 parent aggregator 应有 deadline 和 partial-failure policy；等待状态可由 DB query/event subscription 实现，不必复制 watch channel。

### 7.4 `interrupt_agent`

handler 不允许 interrupt root 或自身，解析 target 后记录 previous status，ThreadNotFound/InternalAgentDied 被视为已达停止目标，并发出 activity event。

云端映射：cancel 应幂等；child 已 terminal/丢失时重复取消仍返回确定结果。parent cancel 需广播到所有 non-terminal children，但不能让 child 任意取消树外 Run。

### 7.5 `list_agents`

返回 agent path/status/last task 等控制面投影。当前项目应提供内部/admin query 或 parent aggregation 读取 child graph，不需要把全树直接暴露给普通前端。

## 8. 路线 F：Status 与完成通知

继续阅读：

- `codex-rs/core/src/agent/status.rs`
- `codex-rs/core/src/agent/registry.rs`
- `codex-rs/core/src/session_prefix.rs`
- `codex-rs/core/src/agent/control_tests.rs`

记录：

- status 哪些是 terminal。
- registry 如何关联 thread id、agent path 和 metadata。
- child completion 如何通知 parent。
- internal agent death 如何清理 registry/thread。
- unknown/not-found 与 failed/interrupted 如何区分。

映射到当前项目时，`AgentRunStatus` 目前只有 RUNNING/COMPLETED/FAILED/ABORTED。Multi-agent 实验可以复用这些 terminal 状态，但 parent aggregation 需要额外表达 partial completion、timeout 和 task result；不要为了 UI 方便把所有含义塞进一段 errorMessage。

## 9. 当前项目反向阅读路线

### 9.1 Schema 与 recorder

- `prisma/schema.prisma`
- `apps/api/src/agent-runtime/agent-run-recorder.service.ts`

问题：

- parentRunId/rootRunId/depth/taskId 如何约束？
- 当前 `createRunWithInitialSteps` 固定四个 steps，如何支持 child task steps 而不复制 recorder？
- parent/child terminal 与未完成 steps 如何原子化？
- child 不创建用户 Message 时，现有必填 `userMessageId` 如何处理？

最后一问很关键：当前 AgentRun 必须关联用户消息，说明模型尚未为内部 Run 做好准备。不要用伪造 user Message 解决；应在实验设计中重构 trigger/input relation，或建专用 child task/run 关联。

### 9.2 Runtime 与 context

- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- Phase 06 的 ContextBuilder。

问题：

- `runTurnStream` 强绑定“用户输入 + assistant Message + stream”是否适合 child？
- 是否应提取不依赖 UI Message 的 `AgentTurnRunner`，由 root/child application service 复用？
- child final result 如何返回结构化对象，而不是文本 delta？
- child context 是否从 parent full history 派生？默认应否。

### 9.3 权限、扩展与预算

回看 Phase 10/11 的实际实现：

- ActorContext 是复制、引用还是 snapshot？
- child tool allowlist 如何与 tenant policy 取交集？
- extension snapshot 如何收窄？
- quota reservation 如何建立 parent-child ledger？
- secret 是否会随 context projection 泄漏？
- 本次实验是否额外强制 read-only，并把任何 REQUIRE_APPROVAL/side-effect/unknown-risk call 直接 deny 而不创建 ApprovalRequest？
- `evidenceRefs` 是否解析到同 tenant/root/child/task/attempt/page 的 canonical Observation，并验证 hash/schema，而非相信模型字符串？
- READY child 与 dispatch outbox 是否同事务，duplicate delivery 是否只有一个 lease owner？

## 10. 推荐阅读顺序

### Session 1：控制树和 spawn

1. `agent/control.rs` 顶部结构与方法列表。
2. v2 `spawn.rs` handler。
3. `control/spawn.rs` 的 spawn/reserve/fork 关键段。
4. 画 Codex parent/child Thread 图。

### Session 2：history 与权限继承

1. `keep_forked_rollout_item`。
2. fork full/last N/new 的分支。
3. environment/exec policy inheritance。
4. 设计当前项目最小 ChildContextProjection。

### Session 3：容量、状态、恢复

1. execution limiter + tests。
2. residency + tests。
3. status/registry/control tests。
4. 画云端 DB/worker/lease/slot 对照。

### Session 4：通信与取消

1. send/follow-up shared message tool。
2. wait。
3. interrupt/list。
4. 决定第一版只保留 spawn/wait-result/cancel 的理由。

## 11. 可以跳过的内容

- MultiAgent v1/v2 兼容迁移的所有分支。
- nickname 列表和 TUI 展示。
- model/service tier override 的产品细节。
- resident child 的 LRU 优化实现。
- 完整 mailbox/steer/follow-up；本实验不实现。
- Codex 工作区 environment 继承的细节；云端替换为 tenant/tool/extension scope。
- agent role 配置格式；只理解 role 不能提升 policy。

不能跳过：parent/depth、三类 capacity 的职责差异、durable READY/outbox dispatch、history filtering、status terminal、cancel、budget、read-only child、evidence integrity 和 tests。

## 12. 阅读产物

- Codex `spawn -> child thread -> status/communication -> completion` 时序图。
- `fork all / last N / none` 对照及当前项目为何选择 task projection。
- 当前 AgentRun schema 对内部 child 不适配的差距清单。
- ChildTaskSpec/Result 与 parent-child state graph 草案，包含 READY/outbox/lease claim 与恢复。
- permission/context/extension/budget 继承矩阵。
- spawn/dispatch/cancel/recovery/partial failure 与 evidence integrity 测试名称。
- 一份明确的“本阶段不实现 mailbox/residency/recursive spawn”说明。

## 13. Teach-back 问题

1. Codex 为什么让 subagent 成为独立 Thread？
2. `keep_forked_rollout_item` 为什么不复制全部工具/推理中间项？
3. registry spawn reservation、v2 residency slot 和 v2 execution guard 分别保护什么？为什么 rollout budget 不属于这三类 capacity？
4. resident child 与 durable child state 有何区别？为什么云端还需要 READY + transactional outbox？
5. send_message 和 followup_task 为什么需要不同 delivery mode？
6. wait 为什么必须有 timeout 与 begin/end events？
7. 当前 `AgentRun.userMessageId` 必填对 child Run 暴露了什么模型缺口？
8. child 权限为何只能与 parent 取交集或收窄？
9. 为什么本次实验直接 deny child Approval/写工具？evidenceRefs 如何防止模型伪造依据？
10. parent cancel 遇到已 terminal child、stale child、不可取消 tool 时分别怎么处理？
11. 如何用 matched pairs 与 paired confidence interval 证明 Multi-agent 收益不是模型调用数量或样本时段造成？
