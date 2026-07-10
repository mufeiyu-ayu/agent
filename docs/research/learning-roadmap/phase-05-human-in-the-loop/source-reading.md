# Phase 05 源码阅读：审批请求如何暂停并继续一次工具调用

## 1. 阅读目标

本次只回答一条问题链：

> Codex 如何从“某次工具执行需要批准”走到“发出审批请求、接收决定、继续或拒绝执行”，当前云端项目又需要在哪些边界做不同翻译？

阅读完成后应得到职责图和状态不变量，不需要掌握 Rust 生命周期、平台 sandbox 系统调用或所有审批策略配置。

## 2. 源码快照与定位方法

- Codex fork：`/Users/ayu/Desktop/codex`，研究基线 `626147f72`。
- 当前项目：`/Users/ayu/Desktop/agent`。
- 若源码更新导致行号漂移，使用下面的符号重新定位：

```sh
rg -n "request_approval|ExecApprovalRequirement|ApprovalCtx" \
  /Users/ayu/Desktop/codex/codex-rs/core/src/tools

rg -n "ExecApprovalRequestEvent|ReviewDecision|notify_approval" \
  /Users/ayu/Desktop/codex/codex-rs/core/src \
  /Users/ayu/Desktop/codex/codex-rs/protocol/src
```

只读取本地源码，不需要联网。

## 3. 第一条链：策略为什么不等于审批

### 3.1 先读 ToolOrchestrator

| Codex 文件 | 重点符号/位置 | 要回答的问题 |
| --- | --- | --- |
| `codex-rs/core/src/tools/orchestrator.rs` | `run`，约 134 行起 | 一次执行被拆成哪些阶段？ |
| 同文件 | approval 分支，约 151 行起 | 为什么 approval 先于 sandbox/execution？ |
| 同文件 | `request_approval`，约 513 行起 | orchestrator 如何只依赖审批接口而不拥有 UI？ |

先画出：

```text
tool runtime request
  -> compute approval requirement
  -> request decision when required
  -> choose sandbox / attempt
  -> classify failure
  -> optional escalation / retry
```

阅读时记录三个结论：

1. 工具 handler 不应自己弹窗或读取前端状态。
2. “需要批准吗”与“用户决定什么”是两个不同输入。
3. 即便被批准，执行仍需要 isolation、timeout 和错误分类。

### 3.2 再读 sandboxing 中的策略原语

| Codex 文件 | 重点符号 | 阅读问题 |
| --- | --- | --- |
| `codex-rs/core/src/tools/sandboxing.rs` | `ApprovalStore` | 会话级已批准记录与单次决定如何区分？ |
| 同文件 | `ApprovalCtx` | 审批请求需要哪些运行上下文？ |
| 同文件 | `ExecApprovalRequirement` | `Skip / NeedsApproval / Forbidden` 如何表达三态策略？ |
| 同文件 | `Approvable` | 具体 runtime 如何提供策略需求，而 orchestrator 保持通用？ |
| `codex-rs/core/src/tools/sandboxing_tests.rs` | requirement tests | 哪些约束由纯单元测试证明？ |

将 `Skip / NeedsApproval / Forbidden` 翻译为当前项目的：

```text
allow / approval_required / deny
```

不要把 `Skip` 翻译为“绕过安全”。它表示现有 policy 判定本次调用不需要人工确认，仍需经过工具 schema、授权、timeout 和执行边界。

## 4. 第二条链：审批如何成为 Runtime 事件

### 4.1 协议对象

| Codex 文件 | 重点符号 | 阅读问题 |
| --- | --- | --- |
| `codex-rs/protocol/src/approvals.rs` | `ExecApprovalRequestEvent` | request 包含哪些 ID、理由和可选 decision？ |
| `codex-rs/protocol/src/protocol.rs` | `ReviewDecision`，约 4046 行 | approved、denied、timed out、abort 为何是枚举而非字符串？ |
| 同文件 | `Op::ExecApproval` / patch approval | decision 如何作为运行期间的新操作进入 Session？ |
| 同文件 | `EventMsg::ExecApprovalRequest` | runtime 到客户端的方向如何表达？ |

这里重点观察 request 和 response 是双向协议：Runtime 先发事件，用户决定随后作为独立 operation 到达。HTTP Controller 不需要一直同步等待在同一个调用栈里。

### 4.2 Session 中的等待点

| Codex 文件 | 重点符号/位置 | 阅读问题 |
| --- | --- | --- |
| `codex-rs/core/src/session/mod.rs` | approval request methods，约 2114-2248 行 | 如何创建 request、注册 waiter 并发出事件？ |
| 同文件 | `notify_approval`，约 2691 行 | decision 如何按 approval ID 唤醒正确等待者？ |
| `codex-rs/core/src/session/handlers.rs` | approval operation dispatch | 运行期间到来的决定为何经过统一 submission 入口？ |

需要提炼的不变量：

- approval 必须有相关 ID，不能用“最近一个弹窗”隐式关联。
- waiter 消失时有默认 abort/deny 语义。
- cancel 与 decision 可能竞态，因此只能有一个最终结果。
- 审批请求事件是投影；真正的执行状态仍由 runtime 拥有。

## 5. 第三条链：运行中 Thread 如何重新投影待审批状态

### 必读测试

| Codex 测试 | 阅读重点 |
| --- | --- |
| `codex-rs/app-server/tests/suite/v2/thread_resume.rs` 中 `thread_resume_replays_pending_command_execution_request_approval` | **running/loaded Thread** 重新订阅后，进程内 pending command approval 如何重发 |
| 同文件中 `thread_resume_replays_pending_file_change_request_approval` | 同一运行中内存机制对不同 approval request 类型如何投影 |
| `codex-rs/app-server/tests/suite/v2/turn_interrupt.rs` | 等待或执行期间 interrupt 的终态 |
| `codex-rs/app-server/tests/suite/v2/turn_start.rs` 中 command/file approval cases | accept/decline 如何影响后续事件和执行 |
| `codex-rs/core/src/tools/sandboxing_tests.rs` | policy requirement 的确定性 |

不要只看 happy path。至少跟踪以下五条：

1. 自动允许。
2. 请求后批准。
3. 请求后拒绝。
4. 等待中 interrupt。
5. 客户端重新订阅仍在运行的 Thread 后重新得到 pending request。

这里不得推出“approval 已写入 rollout”或“进程重启后的 cold Thread 能恢复 waiter”。这两条测试依赖仍加载的 running Thread 和进程内 pending request；rollout/cold resume 没有提供等价的 durable Approval resource。当前云端项目不能依赖常驻进程，所以必须把 Approval 先建成 PostgreSQL canonical resource，再由查询投影恢复 UI。

## 6. 当前项目反向阅读

### 6.1 从 Tool loop 的预期接入点开始

| 当前项目文件 | 当前职责 | 本阶段要问 |
| --- | --- | --- |
| `apps/api/src/agent-runtime/agent-runtime.service.ts` | 创建 Run、采样、流式回复、收口 | policy 应插在 ToolCall schema 校验后的哪个位置？ |
| `apps/api/src/agent-runtime/agent-run-recorder.service.ts` | Run/Step 写入与终态 | 如何表达 waiting，而不把 approval 当 failure？ |
| `apps/api/src/agent-runtime/agent-runtime.types.ts` | 内部 runtime 事件 | 是否需要内部 `approval_required`？字段最小集是什么？ |
| `prisma/schema.prisma` | canonical Message/Run/Step | Approval 独立表还是 JSON step？恢复查询需要什么？ |

阅读时明确当前实现的限制：`AgentRunStatus` 只有 `RUNNING/COMPLETED/FAILED/ABORTED`，`AgentStepStatus` 只有 `PENDING/RUNNING/COMPLETED/FAILED/ABORTED`。如果不增加 waiting 语义，客户端只能靠猜测解释一个长期 RUNNING 的 Run。

### 6.2 外部协议链

```text
AgentRuntimeEvent
  -> toChatStreamEvent
  -> NDJSON
  -> parseChatStreamEvents
  -> useSeoWorkspace
```

逐个阅读：

| 当前项目文件 | 要验证的边界 |
| --- | --- |
| `apps/api/src/seo/seo-chat-stream-event.mapper.ts` | 内部事件不会直接泄漏到外部 |
| `packages/contracts/src/seo.ts` | discriminated union 能否向后兼容扩展 |
| `apps/api/src/seo/seo.controller.ts` | HTTP close 当前被解释为 abort；等待审批时是否应主动正常结束 |
| `apps/web/src/api/seo.ts` | runtime validation 是否会拒绝未知 approval event |
| `apps/web/src/hooks/useSeoWorkspace.ts` | 当前 active state 全在内存；刷新恢复缺什么 API |

关键判断：Phase 05 的 `approval_required` 是产品必须呈现的状态，因此可以有计划地升级外部 contract；但完整 Tool arguments、内部 Step 细节和 policy debug 信息仍不应进入前端事件。

### 6.3 数据与查询链

阅读：

- `apps/api/src/conversations/conversations.service.ts`
- `apps/api/src/conversations/messages.service.ts`
- `apps/api/src/prisma/prisma.service.ts`
- `prisma/schema.prisma`

提出以下问题：

1. 当前 Conversation 查询是否有 owner/tenant filter？答案若为否，本阶段不能假装已经安全多租户。
2. Approval 应如何关联 Conversation、Run、Step 和 ToolCall？
3. 删除 Conversation 时 approval 应否级联删除？审计保留需求是否与当前学习项目冲突？
4. 同一 `toolCallId` 如何防重复创建 approval？
5. 同一个 decisionId 如何防重复执行？
6. `PENDING -> APPROVED` 与“取得执行权”是否需要同一事务或 compare-and-set？

## 7. 云端翻译表

| Codex 本地约束 | 云端 SEO Agent 对应 | 不能直接复制的原因 |
| --- | --- | --- |
| Session 内 approval waiter | PostgreSQL ApprovalRequest + resume trigger | API/worker 进程可能重启 |
| 当前本机用户做决定 | 已认证 user/tenant actor | 云端需要所有权与租户隔离 |
| shell/patch approval | SEO 发布、写 CMS、提交外部任务审批 | 业务风险不同 |
| sandbox profile | timeout、allowlist、最小权限凭证 | 当前不执行不可信代码 |
| ApprovedForSession | 第一版只 allow once | 长期授权需要独立规则与审计 |
| running Thread 的内存 pending request replay | 查询 PostgreSQL canonical approval/run state | Codex 机制不覆盖 rollout/cold recovery，浏览器重连不应依赖旧进程或旧 socket |

## 8. 推荐阅读顺序（两次完成）

### 第一遍：只追主链，约 60-90 分钟

1. `tools/orchestrator.rs::run`
2. `tools/sandboxing.rs::ExecApprovalRequirement`
3. `protocol/approvals.rs::ExecApprovalRequestEvent`
4. `protocol.rs::ReviewDecision`
5. `session/mod.rs` approval request + notify
6. `thread_resume.rs` running Thread pending approval replay test
7. 回到当前 `agent-runtime.service.ts` 和 `schema.prisma`

第一遍输出：一张时序图、一张状态机和五条不变量。

### 第二遍：围绕失败与竞态，约 60 分钟

1. `sandboxing_tests.rs`
2. `turn_interrupt.rs`
3. `turn_start.rs` accept/decline cases
4. 当前 `seo.controller.ts` 的 close/abort 行为
5. 当前 `useSeoWorkspace.ts` 的 active request 状态

第二遍输出：approve/reject/expire/cancel/duplicate 的测试列表。

## 9. 阅读记录模板

每读一个符号，只记录下列内容：

```md
### 符号：ToolOrchestrator::run

- 输入：
- 状态所有者：
- 副作用执行者：
- 事件：
- 持久化事实：
- 取消/失败：
- 测试证据：
- 当前项目迁移：
- 不照搬：
```

## 10. 必须回答的源码问题

### Codex 侧

1. `ExecApprovalRequirement::Forbidden` 为什么不能退化成“请求用户批准”？
2. `ReviewDecision::Denied` 与 `Abort` 有什么不同？
3. approval ID 在 request、waiter、operation 和 resume 测试中如何保持关联？
4. 为什么 ToolOrchestrator 在获批后仍需要 sandbox/execution policy？
5. running Thread 的 pending approval 在客户端重新订阅时为什么需要重投影？为什么这不是 rollout/cold recovery？
6. 如果等待者被丢弃，默认 decision 是什么，为什么？

### 当前项目侧

1. 哪个对象应成为 approval 的 canonical fact？
2. 当前 HTTP close 一律 abort，会不会误杀“正常进入等待审批”的 Run？
3. Run 等待期间页面刷新后，前端从哪里恢复 `approvalId`？
4. decision body 中哪些字段可由客户端提供，哪些必须后端重载？
5. reject 是 Run failure、正常 observation，还是独立 terminal reason？
6. 取消和批准同时到达时，哪一个状态迁移取得执行权？

## 11. 可以跳过的细节

本阶段第一遍可以跳过：

- 各平台 sandbox profile 和系统调用。
- execpolicy 命令模式的完整语法。
- network approval 的 session 级缓存细节。
- patch 审批中 UI diff 的所有字段。
- `ApprovedForSession` 和 policy amendment 的产品化实现。
- MCP elicitation 的协议兼容细节。
- app-server v1/v2 全部转换代码。

只有当当前项目真的需要长期授权、通用外部工具或不可信代码执行时，再深入这些内容。

## 12. 阅读完成证据

- [ ] 能画出 `policy -> approval request -> decision -> execution -> observation`。
- [ ] 能在 Codex 找到 policy、request、decision、waiter、resume test 五个证据点。
- [ ] 能指出当前项目至少六个需要修改的边界，但没有把实现塞进 Controller。
- [ ] 能解释为什么 ApprovalRequest 必须落库。
- [ ] 能解释为什么外部事件不包含完整 Tool arguments。
- [ ] 能列出 approve/reject/expire/cancel/duplicate/cancel-race 测试。
- [ ] 能写出至少三条“不照搬 Codex”的云端差异。
