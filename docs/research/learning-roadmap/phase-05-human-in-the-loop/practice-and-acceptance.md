# Phase 05 练习与验收：用测试证明“批准前绝不执行”

## 1. 练习原则

本阶段的成功标准不是“页面出现确认框”，而是以下安全不变量能被自动化测试证明：

> 对需要审批的 ToolCall，在合法且未过期的 APPROVE 决策原子生效前，副作用执行次数必须始终为 0；决策重放、断流、刷新和竞态都不能让它变为 2。

所有练习应使用 fake model、spy/fake tool、fake clock 和隔离数据库。不要用真实 CMS 发布或真实外部写操作验证基本状态机。

## 2. 练习场景

建议定义两个学习工具：

### 2.1 自动允许工具

```text
inspectSeoMetadata
risk.level=low
risk.sideEffect=none
risk.network=false
```

它用来证明 policy 不会把所有工具都机械地送去审批。

### 2.2 必须审批工具

```text
publishSeoDraft
risk.level=high
risk.sideEffect=external_write
risk.network=true
policy result=approval_required
```

fake executor 只把调用次数、idempotency key 和参数写入内存 spy，不接真实外部系统。

## 3. TDD Cycle A：风险策略

### Red

先写失败测试：

1. `low + none + network=false` 返回 `allow`。
2. `high + external_write` 返回 `approval_required`。
3. 被系统禁止的目标资源返回 `deny`，即使模型参数伪造 `requiresApproval=false` 或另一套 risk 字段。
4. 未知工具或未验证 arguments 不能进入 policy evaluator。
5. action summary 不包含测试 secret。

Red 的价值：当前项目没有独立 ToolPolicy，也无法表达三态结果。

### Green

- 实现纯函数或无副作用 service。
- 只消费 registry definition、已解析参数和 server-side scope。
- 直接复用 Phase 02 `ToolDefinition.risk` 的 `level / sideEffect / network` contract；本阶段不得另造 `riskLevel`、大写枚举或 `requiresApproval` 权威字段。
- 返回稳定 `reasonCode`。
- 第一版规则保持显式，不引入规则引擎。

### Refactor

只有出现第二个真实规则后，才抽取共用 predicate。不要先设计 DSL、优先级系统或图形化 policy builder。

## 4. TDD Cycle B：创建审批 checkpoint

### Red

构造第一轮模型返回 `publishSeoDraft` ToolCall，断言当前实现错误地直接执行，或无法表达 waiting 状态。目标失败断言：

- fake executor 调用次数应为 0。
- 数据库应存在一条 `PENDING` ApprovalRequest。
- ApprovalRequest 应绑定 `conversationId/runId/stepId/toolCallId`。
- Run 与 Tool Step 应进入明确 `WAITING_APPROVAL`。
- stream 应产生一次 `approval_required` 后正常结束。
- assistant Message 不应被标成 FAILED。

### Green

- policy 返回 `approval_required` 时先事务性创建 approval 和 waiting state。
- 输出内部 event，再由 mapper 转为外部事件。
- Controller 正常结束当前 NDJSON，不触发 abort 分支。
- 不执行工具、不继续第二轮 sampling。

### Refactor

- 把 Prisma 事务集中到 approval/store 或 recorder 边界。
- 如果 Runtime 里出现多处状态拼装，再抽出 `pauseForApproval()`。
- 不建立通用 workflow checkpoint abstraction；Phase 07 再评估。

## 5. TDD Cycle C：批准与一次性执行权

### Red

先写以下失败场景：

1. APPROVE 后 fake tool 从 0 变为 1。
2. observation 使用原 `toolCallId` 并进入第二轮模型输入。
3. 相同 `decisionId` 请求两次，fake tool 仍只执行 1 次。
4. 两个不同 decisionId 并发 approve，只有一个取得状态迁移。
5. 客户端篡改 arguments 不影响实际执行参数。
6. decision actor 无权访问 Conversation 时返回拒绝，工具仍为 0 次。

### Green

- decision endpoint 只接收 `decision` 和 `decisionId`。
- 后端重载 ApprovalRequest、ToolCall 与 server-side actor scope。
- 使用条件更新或事务实现 `PENDING -> APPROVED`。
- approval、Run/Step 恢复和执行 lease/idempotency key 有明确原子边界。
- 执行器使用 `toolCallId` 或派生 key 防重复副作用。
- 明确记录 `APPROVED != EXECUTED`：若 decision 已提交而 worker 在 execution/result checkpoint 前崩溃，Phase 05 只能依据最小 execution claim 防本进程重复；跨进程恢复与外部结果未知由 Phase 07 的 ToolExecution/RecoveryPlanner 收口。

### Refactor

- 将“决定审批”和“恢复执行”职责分开，但保持一条清晰 application service 调用链。
- 如果同步执行使 decision HTTP 超时，可返回 accepted/run state；不要在没有 Phase 07 前置时直接引入队列。

## 6. TDD Cycle D：拒绝、过期和取消

### Red

分别建立：

- REJECT：工具 0 次，approval=REJECTED，Run 按产品约定继续或收口。
- EXPIRE：fake clock 越过 `expiresAt` 后 approve 失败，approval=EXPIRED。
- CANCEL：等待时取消 Run，approval=CANCELED，Run/Step=ABORTED。
- 决策竞态：approve 与 cancel 同时到达，最终只能有一个合法状态组合。
- 终态冲突：REJECTED 后再 APPROVE 返回稳定冲突，不改变事实。

### Green

- 将终态迁移写成集中 compare-and-set。
- lazy expiry：查询/决策时发现过期则原子标记；如果已有定时器，可再补 scheduled sweep，但不是必需。
- reject 生成结构化 denial observation 或明确终止 reason。
- cancel 是控制流，不写成普通 error。

### Refactor

- 用单一状态迁移表替换散落判断。
- 提取 fake clock，而不是在测试中真实等待。
- 只在多个 resource 都需要相同 expiry 机制时抽通用 expiry service。

## 7. TDD Cycle E：前端 confirmation UX

### Red

- `parseChatStreamEvents` 当前拒绝 `approval_required`。
- `useSeoWorkspace` 刷新后丢失待审批状态。
- 双击批准可能发出两次不同请求。
- 另一个标签页决定后当前 UI 仍显示可点击。

### Green

- 扩展 shared contract 和 runtime validator。
- API 层新增 approval query/decision。
- composable 通过 canonical API 恢复 pending approval。
- 卡片在提交中禁用；响应后用服务端状态替换本地预测。

### Refactor

- 把请求/状态放在 composable，把展示放在组件。
- 复用现有 `AppMessage` 做网络错误提示，但审批业务状态仍由 ApprovalCard 展示。
- 不把 ToolPolicy 或 arguments 解析搬到前端。

## 8. 单元测试矩阵

| 编号 | 测试对象 | 场景 | 关键断言 |
| --- | --- | --- | --- |
| U05-01 | ToolPolicy | `low/none/network=false` | `allow`，稳定 reasonCode |
| U05-02 | ToolPolicy | `high/external_write` | `approval_required` |
| U05-03 | ToolPolicy | 禁止资源 | `deny`，不能被用户批准绕过 |
| U05-04 | ToolPolicy | 模型试图覆盖 risk | 仍使用 registry metadata |
| U05-05 | Summary builder | args 含 secret | summary 不含 secret |
| U05-06 | Approval transition | PENDING -> APPROVED | 合法 |
| U05-07 | Approval transition | APPROVED -> REJECTED | 拒绝迁移 |
| U05-08 | Approval transition | 过期 PENDING | 变为 EXPIRED |
| U05-09 | Decision idempotency | 同 decisionId 重放 | 返回同一结果 |
| U05-10 | Decision conflict | 不同 decision 改终态 | 稳定冲突码 |
| U05-11 | Event mapper | internal approval event | 最小外部字段 |
| U05-12 | Stream parser | approval NDJSON | 正确校验并 yield |

## 9. Runtime 集成测试矩阵

| 编号 | 输入/注入 | 预期状态链 | 副作用断言 |
| --- | --- | --- | --- |
| I05-01 | 只读 ToolCall | RUNNING -> COMPLETED | tool=1，approval=0 |
| I05-02 | 写 ToolCall | RUNNING -> WAITING | tool=0，approval=PENDING |
| I05-03 | 等待后 approve | WAITING -> RUNNING -> COMPLETED | tool=1，第二轮 sampling=1 |
| I05-04 | 等待后 reject | WAITING -> 约定终态 | tool=0，denial observation 存在 |
| I05-05 | 等待后 expire | WAITING -> 约定终态 | tool=0 |
| I05-06 | 等待后 cancel | WAITING -> ABORTED | tool=0，approval=CANCELED |
| I05-07 | 重复 approve | 最终只完成一次 | tool=1 |
| I05-08 | approve/cancel 竞态 | 只有一个合法终态 | tool 最大 1 次 |
| I05-09 | decision 持久化失败 | 不取得执行权 | tool=0 |
| I05-10 | tool 获批后失败 | approval 保持 APPROVED，step FAILED | 不重复请求 approval |
| I05-11 | approve 后 observation 写失败 | Run 可诊断 | 不盲目重做副作用 |
| I05-12 | 浏览器流断开 | approval 仍可查询 | tool=0 |
| I05-13 | APPROVED 提交后、execution claim/result 前崩溃 | APPROVED 仍可查询，executed 不可凭空推断 | 仅按持久 execution fact/幂等策略恢复；无证据时人工核对 |

## 10. API Contract 测试矩阵

| 编号 | 请求 | 预期 |
| --- | --- | --- |
| C05-01 | 合法 pending approval 查询 | 返回脱敏 view model |
| C05-02 | 不存在/无权 approval | 404 或统一授权策略，不泄漏存在性 |
| C05-03 | APPROVE + decisionId | 返回 canonical status/run reference |
| C05-04 | 相同请求重放 | 200 且结果一致 |
| C05-05 | 已 REJECTED 后 APPROVE | 409 stable code |
| C05-06 | 已 EXPIRED 后 APPROVE | 410/409 stable code |
| C05-07 | body 携带多余 tool args | DTO 拒绝或完全忽略，不能成为权威输入 |
| C05-08 | `approval_required` NDJSON | shared contract、server mapper、web parser 一致 |
| C05-09 | stream 等待审批后 EOF | 前端不误报“提前结束” |
| C05-10 | cancel waiting Run | approval 和 Run 查询均为一致终态 |

## 11. 数据库与并发测试

需要真实测试数据库或等价 Prisma integration test，不能只 mock Prisma 调用次数：

- 同一 `(runId, toolCallId)` 只能创建一个 active approval。
- 两个并发 decision 只能有一个从 `PENDING` 更新成功。
- approval 创建和 Run/Step waiting 迁移要么一起成功，要么一起回滚。
- decision 持久化和执行权领取的边界有明确证据。
- Conversation 删除/归档与 pending approval 的行为符合设计。
- `expiresAt` 查询有索引或至少记录未来触发条件。
- audit 字段在每种终态下完整且互相一致。

建议在测试中用 barrier 同时释放两个 Promise，而不是依赖“快速连续调用”模拟并发。

## 12. 运行演练

自动化测试通过后，再做一次本地演练：

### 演练 A：批准

1. 发起会触发 `publishSeoDraft` 的输入。
2. 保存 `conversationId/runId/toolCallId/approvalId`。
3. 确认等待时 fake/测试目标尚未变化。
4. 刷新页面，确认 ApprovalCard 可恢复。
5. 点击批准。
6. 确认 tool step 完成、第二轮模型输出最终解释。

### 演练 B：拒绝

1. 发起同类输入。
2. 点击拒绝。
3. 确认工具没有执行。
4. 确认最终回复明确说明未执行，而不是伪造成功。

### 演练 C：过期与竞态

1. 使用短 TTL 或测试时钟制造过期。
2. 过期后点击批准，确认稳定错误和 canonical EXPIRED。
3. 两个标签页同时操作同一 approval，确认最终状态收敛且工具最多执行一次。

## 13. 故障注入练习

| 故障点 | 注入方式 | 应证明的性质 |
| --- | --- | --- |
| 创建 approval 前 DB 失败 | store fake 抛错 | Run 不能假装 WAITING，工具不执行 |
| 创建后事件写出失败 | 断开 response | approval 可查询，事件不是事实源 |
| decision 更新前断开 | abort request | 未更新则仍 PENDING，可安全重试 |
| decision 更新后响应丢失 | 丢弃 HTTP response | 同 decisionId 重试返回 APPROVED，不重执行 |
| APPROVED 后进程崩溃 | 销毁 runtime，再查询 DB | Approval 只证明授权；不得据此声称工具成功，跨进程执行未知风险交给 Phase 07 |
| executor 超时 | fake tool pending | approval 已批准但 tool step 明确 FAILED/TIMEOUT |
| observation 持久化失败 | recorder fake 抛错 | 记录“副作用可能已发生”，禁止盲目重复 |
| cancel 与 approve 同时 | barrier 并发 | 只有一个状态迁移获胜 |

## 14. 安全负向测试

- [ ] 模型 arguments 中伪造 `tenantId` 不改变服务端 scope。
- [ ] 客户端 decision body 中伪造 `toolName` / `arguments` 不被使用。
- [ ] 无权用户不能通过猜 approvalId 读取 action summary。
- [ ] `actionSummary` 不包含 token、cookie、Authorization header 或完整 secret。
- [ ] Step input/output 和结构化日志同样经过脱敏。
- [ ] `deny` 不能通过用户点击 approve 绕过。
- [ ] 已批准但资源权限随后被撤销时，执行前重新授权并拒绝。
- [ ] 超大 arguments 不会无限写数据库或返回前端。

## 15. 验收证据模板

每条退出标准都按以下格式登记，不要只勾 checkbox：

```md
### Requirement：批准前副作用次数为 0，重复批准后最多为 1

- Unit test：`...tool-policy.service.spec.ts` / case name
- Integration test：`...approval-resume...spec.ts` / case name
- Database evidence：Approval PENDING -> APPROVED，toolCallId=...
- Runtime evidence：fake executor calls=1，second sampling input 含 callId=...
- Result：PASS / FAIL
- Remaining risk：真实外部系统是否支持相同 idempotency key 尚未验证
```

## 16. 阶段验收清单

### 架构

- [ ] Policy、Approval、Authorization、Execution 四个职责没有混在 Controller 或 Vue 组件。
- [ ] ApprovalRequest 是 canonical resource，不依赖内存 Promise 才能查询。
- [ ] 外部事件只暴露最小脱敏 view。
- [ ] decision 后端重载原 ToolCall。

### 状态机

- [ ] PENDING 只有四个合法终态：APPROVED/REJECTED/EXPIRED/CANCELED。
- [ ] 终态不可相互转换。
- [ ] Run/Step/Approval/Message 状态组合有测试表。
- [ ] reject/cancel/expire 不被误记为 provider error。

### 幂等与竞态

- [ ] 同一 toolCall 不重复创建 approval。
- [ ] decisionId 重放幂等。
- [ ] 并发 decisions 只有一个获胜。
- [ ] approve/cancel race 最多执行一次。
- [ ] `APPROVED` 与 `EXECUTED` 有独立断言；批准后 crash 的 residual risk 和 Phase 07 恢复前提已写入证据。

### 产品体验

- [ ] approve/reject 均有明确 UI。
- [ ] 页面刷新可以恢复 pending approval。
- [ ] 过期和其他标签页已决定会收敛到服务端状态。
- [ ] 提交中防双击，但后端仍具备真正幂等。

### 安全与审计

- [ ] 模型和客户端都不能降低 risk metadata。
- [ ] 参数摘要脱敏。
- [ ] actor、时间、reasonCode、decision 有审计记录。
- [ ] 真实身份/租户未实现的限制被明确记录，不能宣称生产安全。

### 工程验证

- [ ] 相关 unit tests 通过。
- [ ] runtime integration tests 通过。
- [ ] Prisma transaction/concurrency tests 通过。
- [ ] API/NDJSON contract tests 通过。
- [ ] `pnpm --filter @agent/api typecheck` 通过。
- [ ] `pnpm --filter @agent/web typecheck` 通过。
- [ ] `pnpm typecheck` 与 `pnpm lint` 通过。
- [ ] Prisma 有改动时 `pnpm prisma:generate`、`pnpm exec prisma validate` 通过。

## 17. Teach-back 复盘问题

不看文档回答：

1. 为什么 approval 不能只是一个 `confirm()`？
2. `deny` 为什么不能升级成“让用户强行批准”？
3. 什么是一次性执行权，数据库层如何证明只有一个请求拿到？
4. decisionId 与 tool idempotency key 分别保护哪一段？
5. 为什么审批通过后还要重新检查 authorization？
6. 如果 HTTP 响应在批准落库后丢失，用户重试会发生什么？
7. 如果工具成功但 observation 写库失败，为什么不能直接重做工具？
8. 当前项目与 Codex 的审批恢复最大差异是什么？
9. action summary 与 canonical arguments 为什么必须分开？
10. 哪个测试最有力地证明“批准前 0 次，批准后最多 1 次”？

## 18. 阶段完成记录

```md
### 我现在能解释

- ...

### 我仍不确定

- ...

### 这次从 Codex 学到的约束

- ...

### 当前项目没有照搬的部分

- ...

### 核心证据路径

- ...

### Phase 06 前置是否满足

- [ ] ToolCall/Observation 已有合法 model history 表达
- [ ] Approval 等待不会污染 UI Message history
- [ ] ContextBuilder 可以识别 approval/tool facts 的优先级需求
```
