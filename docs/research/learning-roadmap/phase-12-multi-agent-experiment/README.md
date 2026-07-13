# Phase 12：Multi-agent 有界实验

> 模块分类：**Optional**。当前项目不实现；只有单 Agent 基线、恢复、安全和预算都可测时才做对照实验。

## 阶段文件

- [README.md](./README.md)：实验边界、child contract、调度、继承与 GO/NO-GO 标准。
- [source-reading.md](./source-reading.md)：Codex AgentControl、spawn、容量、通信与恢复源码路线。
- [practice-and-acceptance.md](./practice-and-acceptance.md)：公平 A/B、竞态/故障测试矩阵与验收证据。

## 1. 阶段定位

Multi-agent 在本路线中是最后一个架构实验，不是“Agent 看起来更高级”的功能。只有当单 Agent 已经可测试、可恢复、可授权、可计费并支持受控扩展后，才有资格验证多个独立执行单元是否真的改善某类 SEO 任务。

本阶段核心问题是：

> 对一个天然可拆分的 SEO 任务，父 Agent 如何生成边界明确的子任务，子 Agent 如何以独立 Run 与最小上下文执行，结果如何结构化汇总，同时让权限、预算、取消、失败和持久化可控；最终它是否比单 Agent 基线更好？

“更好”必须由固定数据集上的质量、成本、延迟和稳定性共同证明。若没有收益，正确结果是记录失败并不进入产品主线。

## 2. 进入条件

开始实验前必须满足：

- 单 Agent Tool loop、Approval、Context、Recovery、Concurrency、Observability 均完成自动化验收。
- Phase 10 tenant scope、tool authorization、quota 和 secret redaction 已稳定。
- Phase 11 extension snapshot 可冻结，子 Agent 不会在运行中看到漂移的工具/skill。
- 有 Phase 09 固定 SEO eval dataset 与单 Agent baseline。
- 一次 Run 的 model/tool token、费用、延迟和失败可以准确归因。
- parent abort 能通过持久化或 runtime token 传播到 tool sampling；否则更无法安全传播到 children。

缺少任一条件时，只做离线 task contract 设计，不创建并行 child execution。

## 3. 从 Codex 学到的关键原则

### 3.1 子 Agent 是独立执行上下文

Codex 的 subagent 创建独立 Thread，有 parent thread、depth、agent path/role、自身 history、状态和生命周期。它不是把“研究员/审稿人/写作者”三个名字塞进同一个 prompt。

迁移到当前项目：

- 每个 child 至少是独立 `AgentRun`，拥有自己的 model history、steps、usage、status 和 cancel scope。
- child output 通过显式 `ChildTaskResult` 回到 parent，不把 child 的全部 transcript 拼回 parent。
- child 不直接写用户可见 `Message`；parent 负责最终回答与 UI Message。
- 若未来 child 需要多轮 resume/mailbox，再引入内部 `AgentThread`；一次性实验不要拿用户 Conversation 冒充内部 Thread。

### 3.2 Spawn 有容量预留

本地快照中不能把所有 “capacity” 混成一个计数器。Codex 实际有三个不同边界：

| 边界 | 源码职责 | 何时占用/释放 | 不能误解为 |
| --- | --- | --- | --- |
| AgentRegistry spawn reservation | 为 child metadata/path/nickname 与已注册 thread 预留位置；非 v2-residency 路径可带 max-thread 限制 | spawn 前 reserve，失败时 Drop 回滚，成功 commit；thread 从 registry 移除时释放 | 正在执行 turn 的数量 |
| V2 residency slot | 限制当前进程 loaded resident child，计入 residents + pending slots；满时可卸载 terminal、idle、无 pending mailbox 的 LRU child | load/spawn 前 reserve，加载 commit；卸载/失败释放 | durable child 数或 active execution 数 |
| V2 execution limiter/guard | 限制真正 active 的 subagent turns；`ensure_execution_capacity_for_op` 对会启动 turn 的 op 检查，执行 guard 在 turn 生命周期释放 | turn 开始/结束 | spawn/loaded thread 数 |

共享 `RolloutBudget` 是第四个独立的 usage accounting/reminder 边界，不是上述 slot capacity，也不是云端可直接照搬的 durable quota reservation。Codex spawn 路径会做 execution capacity 预检查，但 execution guard 并不是在 spawn 时就永久占住；v2 residency 和 active turn 也可能使用相同配置上限，却保护不同资源。

迁移到云端：

- spawn 前原子预留 child slot 与预算。
- `maxChildren`、`maxDepth`、tenant concurrency、per-parent cost 都有硬上限。
- guard/lease 在 child terminal 后释放，崩溃由 recovery 回收。
- 不允许模型通过连续 spawn 绕过主 Run budget。

### 3.3 继承是显式且可收窄的

Codex spawn 会处理 environment、exec policy、role/config 与 forked history。当前项目的云端翻译：

- tenant/actor identity 由 parent 派生，不能由模型参数指定。
- child tool policy = parent 有效权限与 child task allowlist 的交集。
- extension snapshot 同源或更窄，不允许运行时扩大。
- budget 从 parent 分配，child 不能自增。
- context 使用 task-specific projection，不默认复制完整 Conversation。

### 3.4 通信是消息与状态，不是共享可变数组

Codex 有 send/follow-up/wait/interrupt/list 等工具与 mailbox/activity。当前实验第一版只需：spawn、await terminal、collect structured result、cancel。双向 mailbox、steer 和 follow-up 是后续能力，不能为了模仿 Codex扩大实验。

## 4. 选择正确实验任务

### 4.1 推荐任务

选择“多页面技术 SEO 审计与聚合”：

```text
输入：同一站点 3-5 个页面的标准化页面快照

子任务：
  page-audit(page A)
  page-audit(page B)
  page-audit(page C)

父任务：
  聚合重复问题
  排优先级
  输出站点级修复计划
```

适合原因：页面分析相互独立、可以并行、子结果有统一 schema、父层聚合有明确价值。

### 4.2 不适合任务

- 一段短文改写：拆分成本高于收益。
- 强顺序依赖的单页分析：并行无意义。
- 需要 children 同时写同一外部资源：冲突与幂等复杂。
- 需求本身不清楚：多个 Agent 只会放大不确定性。
- 需要 child 自由创建更多 child：第一版禁止递归。

## 5. 单 Agent 基线

在 Multi-agent 之前冻结：

- 同一模型、reasoning effort、tools、skills 和输入数据。
- 相同总 token/tool budget。
- 相同输出 schema 和评分器。
- 至少 20 个多页面站点样本，包含正常、部分失败、冲突信号和超长页面。
- 至少重复运行若干次，记录方差。

基线指标：

| 指标 | 含义 |
| --- | --- |
| finding precision/recall | 问题识别准确性与覆盖 |
| prioritization score | 站点级优先级是否合理 |
| unsupported claim rate | 是否编造未由 page/tool 证据支持的结论 |
| total latency / first useful result | 总耗时与可用结果速度 |
| input/output tokens | 总模型消耗 |
| tool calls / external cost | 工具与付费依赖消耗 |
| completion rate | terminal success/partial/failure |
| retry variance | 多次运行稳定性 |

Multi-agent 使用总预算必须与单 Agent 公平比较；不能给多个 child 无限 token 后只比较质量。

## 6. 领域 Contract

### 6.1 ChildTaskSpec

```ts
interface ChildTaskSpec {
  taskId: string
  kind: 'page_seo_audit'
  pageRef: string
  objective: string
  expectedOutputSchemaVersion: string
  toolAllowlist: readonly string[]
  contextRefs: readonly string[]
  budget: ChildBudget
  deadlineAt: string
}
```

`pageRef` 由服务端解析且属于 parent tenant；模型不能直接传入 tenantId 或 connector credential。

### 6.2 ChildTaskResult

```ts
type ChildTaskResult =
  | {
      status: 'completed'
      taskId: string
      pageRef: string
      findings: SeoFinding[]
      evidenceRefs: EvidenceRef[]
      usage: UsageSummary
    }
  | {
      status: 'failed' | 'aborted' | 'timed_out'
      taskId: string
      errorCode: string
      retryable: boolean
      usage: UsageSummary
    }
```

```ts
interface EvidenceRef {
  evidenceId: string
  pageRef: string
  observationId: string
  contentHash: string
  schemaVersion: string
}
```

父层只接收 validated result，不接收 child chain-of-thought。child 的最终自然语言可作为诊断，但不应成为唯一 machine contract。

`evidenceRefs` 不是模型可自由编造的字符串：服务端 validator 必须确认 evidence/observation 存在，属于同一 tenant/root/child attempt，pageRef 与 task 一致，来源 ToolStep 已成功或处于明确可引用状态，content hash/schema version 匹配安全快照。每个 finding 至少引用一个通过验证的 evidence；未知、跨租户、跨 task、过期 attempt 或 dangling ref 使整个 child result 无效。parent 可以合并多个 child 的已验证 refs，但不能生成未落库的新引用。

### 6.3 Parent aggregation

父层负责：

- 等待 children 到终态或 deadline。
- 按 taskId 对齐，拒绝未知/重复 result。
- 去重相同 findings，保留 evidence lineage。
- 表达 partial success，不伪装为全量成功。
- 在总预算允许时决定是否重试一个 child；不可让模型无限重试。
- 生成唯一用户可见 assistant message。

## 7. 持久化模型选择

### 7.1 最小实验方案

在 `AgentRun` 上增加或等价表达：

```text
kind: ROOT | CHILD
parentRunId?: string
rootRunId: string
taskId?: string
depth: number
role?: string
```

另保存 task spec/result 的安全快照或专用 `AgentTask` 资源。parent/child 都有独立 steps 与 usage。

### 7.2 什么时候需要 AgentThread

只有出现以下真实需求时再建内部 Thread：

- child 要接受 follow-up 输入并多轮运行。
- child 要在进程重启后保留自己的长期 context。
- 多个 child turns 需要 mailbox。
- child 能被暂停、恢复或复用。

一次性 page audit 使用独立 child Run + isolated context 足够；不要创建一堆用户可见 Conversation 污染会话列表。

### 7.3 状态不变量

- child 必须有且只有一个 parent；root 无 parent。
- `rootRunId` 沿树保持一致。
- 第一版 `depth=1`，child 禁止 spawn。
- durable child 的最小 dispatch 状态为 `READY -> RUNNING -> terminal`；worker 通过条件更新取得 lease 并原子完成 `READY -> RUNNING`。READY 必须可被重投，不能依赖 create 后的内存 Promise。
- parent COMPLETED 前所有 child 必须 terminal，或明确记录 detached policy（本阶段不允许 detached）。
- parent 的 aggregated status 能区分 completed、partial、failed、aborted。
- parent abort 后不得再产生新的 child/tool/model side effect。

## 8. 调度与容量

### 8.1 Spawn 流程

```text
parent proposes task specs
  -> validate decomposition
  -> resolve tenant resources
  -> intersect permissions/tools/extensions
  -> reserve child count + token/tool/cost budgets
  -> one transaction: create READY child runs/tasks + reservations + dispatch outbox rows
  -> outbox dispatcher publishes/polls idempotently
  -> bounded worker atomically claims READY -> RUNNING with lease
  -> child heartbeats/checkpoints
  -> terminal results
  -> release/reconcile reservations
```

### 8.2 Durable READY / outbox dispatch

child row 与“需要调度它”的事实必须在同一数据库事务提交。推荐最小 transactional outbox：每个 `(childRunId, attempt)` 有唯一 `child_run.dispatch_requested` 记录；dispatcher 可重复投递，worker 使用条件更新原子 claim，只允许一个 lease owner 把 READY 变为 RUNNING。ACK 丢失会再次投递但不会重复执行；进程在 rows 后、enqueue 前崩溃时，未发送 outbox 仍会被轮询；READY 等待超时或 RUNNING lease 过期由 sweeper 重投、恢复或安全终结并对账 reservation。

单实例也要经过同一 outbox/poller contract；可以不引入 Kafka，但不能把“事务后立即 `void runner()`”当 durable dispatch。RUNNING 只在成功取得 execution lease 后写入，不能在尚未被 worker 接管时提前标记。

### 8.3 最小上限

- `maxDepth = 1`。
- `maxChildren` 从 2-3 起，不由模型自行配置。
- 每 child 有 token/tool/time budget。
- parent 有总 budget，children reservation 总和不能超过。
- tenant 有全局 active child 上限。
- 同一 pageRef 默认只允许一个 active task，避免重复工作。

### 8.4 执行位置

如果 Phase 07/08 已有 worker/lease，children 可作为普通 durable jobs；若仍是单实例，先做 in-process bounded scheduler + DB canonical state。不要仅因 Multi-agent 引入 Kafka/workflow engine。

## 9. Context 与权限继承

### 9.1 最小上下文投影

child 只获得：

- task objective 与 output schema。
- 对应 page 的标准化数据/reference。
- 必要 system/developer instructions。
- 允许的 skill 片段。
- 明确 tool definitions。
- parent 要求的 evidence format。

默认不获得：完整 Conversation transcript、其他页面原文、parent 的 internal step、credential、其他 child transcript。

### 9.2 权限公式

```text
ChildEffectivePolicy =
  ParentEffectivePolicy
  ∩ TenantCurrentPolicy
  ∩ ChildTaskToolAllowlist
  ∩ ExtensionSnapshotPolicy
```

任何一层 deny 都不能被 role prompt、skill 或 ToolCall 覆盖。本阶段把“建议只读”升级为硬门槛：`ReadOnlyExperimentPolicy` 与上式再取交集；只有平台本地评级为 read-only 且无副作用的工具可见/可执行。任何会得到 `REQUIRE_APPROVAL`、写入/外发副作用或风险未知的 call 都直接 `DENY_CHILD_EXPERIMENT`，不得创建 ApprovalRequest，executor invocation count 为 0。若确实需要交互式写动作，由 parent 在 Multi-agent 实验之外启动独立 root/user flow，不能借 child approval 扩权。

## 10. 取消、失败与恢复

### 10.1 Parent cancel

1. canonical parent 写 `cancelRequestedAt`。
2. scheduler 阻止新 child spawn。
3. 向所有 non-terminal child 传播 cancel。
4. children 向 sampling/tool AbortSignal 传播。
5. child terminal 为 ABORTED；parent 等待有界 grace period。
6. 不可取消外部调用完成后丢弃/审计其结果，不能继续聚合为成功。

### 10.2 Partial failure

为实验明确策略：

- 1/N child 失败，其他完成：parent 可输出 partial result，并明确缺失 page。
- 超过失败阈值：parent FAILED。
- retry 只对分类为 retryable 且预算允许的 child，使用同一 task id + 新 attempt。
- 一个 child 的失败不自动取消无关 children，除非 parent 目标已不可达。

### 10.3 Crash recovery

- 识别 stale child RUNNING。
- lease 过期后按 Phase 07 策略 resume 或 terminal fail。
- parent 恢复时从 DB 重建 child graph，不依赖内存 Promise 数组。
- task/result/result aggregation 均幂等。
- 重启后预算 reservation 可 reconcile。

## 11. 实验任务拆分

### Task 12.1：Baseline 与成功阈值

- 冻结 eval dataset/config/budget。
- 跑单 Agent 多次基线。
- 预先定义 Multi-agent 晋级阈值，避免看结果后改标准。

### Task 12.2：Child contract 与 persistence

- 定义 task/result schema、parent/root/depth。
- 数据库约束和状态机测试。
- child context 与 user-visible Message 分离。

### Task 12.3：Bounded scheduler

- 原子 reservation。
- READY child + transactional outbox + idempotent claim/dispatch。
- max children/depth/concurrency/deadline。
- terminal/cancel/recovery。

### Task 12.4：Page audit children

- 所有 child 使用同一 role/runtime 和只读 tool allowlist。
- approval-required/side-effect/unknown-risk call 一律 deny，child 不产生 ApprovalRequest。
- isolated context。
- structured result validator。
- evidenceRefs 做 tenant/root/child/task/attempt/page/hash/schema 完整性验证。

### Task 12.5：Parent aggregation

- 对齐、去重、evidence lineage、partial status。
- 最终回答只由 parent 生成。
- aggregation 本身计入 budget/trace。

### Task 12.6：A/B 实验与结论

- 相同样本、replicate/seed、总预算和评分器的 matched-pair 设计，随机化执行顺序。
- 报告每对 delta、paired bootstrap 95% CI（或预注册的等价配对方法）、质量/成本/延迟/稳定性；安全 gates 不以统计平均替代。
- 明确 GO / NO-GO；NO-GO 也算阶段成功。

## 12. Red-Green-Refactor 总路线

### Red

- child 共享 parent mutable history，结果串扰。
- 模型创建超上限 children 或递归 spawn。
- child 获得 parent 未授予的工具/tenant resource。
- parent cancel 后 child 继续执行。
- child 失败导致 parent 永久 waiting。
- 重启后 parent 找不到 child graph。
- child rows 已提交但 dispatch 丢失，永久停在 READY/RUNNING。
- child 生成任意 evidence id，parent 未校验就写入最终结论。
- child 触发 Approval 或写工具，扩大了实验风险面。
- 多 Agent 只增加成本，没有基线证明。

### Green

- 独立 child Run/context/status/usage。
- task/result schema + parent/root/depth constraints。
- bounded scheduler + atomic budget reservation。
- transactional READY/outbox + lease claim/recovery。
- permission/extension intersection。
- read-only/approval-deny child gate + evidence ref integrity。
- cancel/failure/recovery propagation。
- 公平 baseline A/B。

### Refactor

- 只有第二类 child task 出现后再抽象通用 TaskPlanner。
- 只有需要 mailbox 时才增加 inter-agent message store。
- 只有 DAG 依赖出现时才考虑 workflow abstraction。
- 不做角色 class hierarchy；role 先是受版本控制的配置。

## 13. 明确非目标

- 不允许 child 递归创建 child。
- 不实现通用 supervisor swarm、辩论/投票 Agent。
- 不让 children 并行写同一外部资源。
- 不建设自由形式 mailbox、follow-up/steer UI。
- 不让前端展示每个 child token delta。
- 不复制 Codex 的完整 fork history；默认最小 task context。
- 不因实验引入新的模型 provider、MCP server 或复杂 RAG。
- 不以“运行更快一次”作为价值证明。

## 14. 退出标准

技术退出标准：

- child 是独立可查询 Run，parent/root/depth/task/result 可恢复。
- READY child 与 dispatch outbox 同事务，重复投递/claim/crash 可恢复，不存在 rows 后 enqueue 丢失窗口。
- max depth/children/concurrency/token/tool/cost/deadline 均有硬限制和测试。
- child 权限和扩展只会与 parent 取交集或收窄。
- child 只允许系统评级 read-only 工具；approval-required/side-effect/unknown-risk 调用不创建 ApprovalRequest 且执行次数为 0。
- parent cancel、child timeout、partial failure、stale recovery 有自动化证据。
- parent 只消费 validated structured results；每条 finding 的 evidenceRefs 通过 tenant/root/child/task/attempt/page/hash/schema 完整性校验并保留 lineage。
- 所有 Run/Step/usage 可由 trace 串联，且不暴露 child chain-of-thought。

产品晋级标准：

- 在预先定义的 eval 上达到质量阈值。
- 总成本、P95 latency 与失败率在可接受范围。
- 相比单 Agent 的收益不是偶然个例：matched-pair 报告包含每对 delta、预注册置信区间方法、95% CI、方差和全部失败样本。
- 若未达到，则输出 NO-GO，保持实验代码隔离或移除，不进入默认产品路径。

## 15. 阶段交付物

- Multi-agent experiment ADR 与 NO-GO 条件。
- 单 Agent baseline 报告。
- ChildTaskSpec/Result contract 与 schema tests。
- parent-child durable state 图。
- bounded scheduler/cancel/recovery 测试。
- context/permission/extension inheritance matrix。
- A/B 评测报告与 GO/NO-GO 决策。
- 一份“为什么 child 是独立 Run，而不是角色 prompt”的讲解。

## 16. 最终判断

本阶段只有两个合格结局：

1. **GO**：在公平预算下有重复可验证的收益，并保留有界架构。
2. **NO-GO**：证据表明复杂度、成本或失败率不值得，清楚记录原因，不让实验进入主线。

“已经能 spawn 两个模型请求”既不是学习完成，也不是产品价值。
