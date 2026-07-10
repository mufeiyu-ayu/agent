# Phase 10 练习与验收：用负向证据证明租户边界

## 1. 实践原则

安全阶段不能以“登录成功”“页面看不到别人的按钮”作为完成证据。每项能力都应至少有：

- 一个同租户 happy path。
- 一个跨租户/低权限 denial path。
- 一个伪造前端或模型参数的 adversarial path。
- 一个并发、重放或失败收口 path。
- 一份不包含敏感原文的审计证据。

授权核心练习先使用测试 actor、fake identity provider、fake model 和 fake tool，保证失败可控；但 Phase 10 的退出验收还必须经过真实 JWT/OIDC（或等价）认证 adapter。fake 证明授权规则，真实 adapter 证明签名和 claims 信任链，两类证据缺一不可。若只有固定 demo actor，必须以 `SINGLE_USER_DEMO` 显式启动、公开/production 配置 fail fast，且阶段状态不能标记 Completed。

## 2. 练习夹具

### 2.1 最小数据集

```text
Tenant A
  alice: ADMIN
  amy: MEMBER
  conversationA
  connectorA

Tenant B
  bob: ADMIN
  conversationB
  connectorB

Platform
  serviceCron: SERVICE
```

为每个主体生成 server-side `ActorContext`。测试中禁止通过请求 body 直接创建任意角色；应由 fake authenticator 根据测试 token 映射。

### 2.2 Canary 数据

- `SECRET_CANARY_TENANT_A_7f3...`：模拟 connector secret。
- `PRIVATE_OBSERVATION_A_...`：模拟不应进入日志的原始 tool output。
- `PUBLIC_SUMMARY_A_...`：允许进入 model context 的安全摘要。

验收时在 model request capture、HTTP body、NDJSON、AgentStep JSON、logger capture、trace exporter 中搜索 canary。

## 3. 练习一：资源归属与身份边界

### Red

先写会失败的测试：

1. Bob 使用 `conversationA.id` 调用 get/update/delete，当前服务会仅按 id 命中。
2. Bob 使用 `conversationA.id` 调用 messages list。
3. Bob 使用 `conversationA.id` 发起 streaming Run。
4. 请求 body 写入 `tenantId=A`，而认证主体属于 B。
5. 没有认证信息时调用资源接口。
6. 已删除或已退出 Tenant A 的成员继续使用旧 token。

Red 的断言必须证明当前缺口，不能先把预期写成模糊的“抛异常”。应断言稳定 code、无数据库变更、无 Run/Message 被创建、无模型调用。

### Green

- Authentication layer 生成 `ActorContext`。
- 应用服务显式接收 `actor`。
- Conversation 的 create/list/get/update/delete 全部带 scope。
- Message 与 AgentRun 通过 scoped Conversation 或冗余 tenant 字段验证。
- 匿名、非成员和跨租户请求在模型调用前终止。
- 外部统一返回 404 或约定的 permission code，内部审计保留真实 denial reason。

### Refactor

- 当多个服务出现相同 `{ id, tenantId }` 条件时，提取 `TenantScopedConversationStore`。
- 保持 store contract 明确，不做通用 `BaseRepository<T>`。
- 把 Nest request 类型留在 adapter 层，不让 Prisma store 依赖 HTTP。

## 4. 练习二：工具授权不能由模型决定

选择一个只读 SEO 工具，例如读取已绑定站点的摘要。

### Red

- ToolCall arguments 传入 `tenantId=B`，Run 属于 A。
- ToolCall 引用 `connectorB` 或 `siteB`。
- MEMBER 调用仅 ADMIN 可用的设置工具。
- tenant plan 未启用该工具。
- 用户通过 Approval UI 点击同意，但原本没有资源权限。
- executor 抛异常时把完整 arguments（含 canary）写入错误。

### Green

- ToolDefinition 中只有业务参数，不接收权威 tenant/actor。
- executor 从 RunContext 取得 actor 和 tenant。
- ToolAuthorizationPolicy 使用解析后的 arguments 找到目标 resource，再做 scope 检查。
- policy 先产出 `ALLOW | REQUIRE_APPROVAL | DENY`；DENY 永不进入 approval。
- approval decision 后重新加载 call 与 actor 权限，避免等待期间成员关系变化。
- 输出分别生成 `modelView`、`auditView` 和可选 `userView`。

### Refactor

- 只有第二种资源工具出现后，再提取通用 `ResourceRef`。
- 只有规则开始组合时再实现 policy chain；第一版用纯函数/明确 service。
- 权限判断不得藏在 ToolDescription 或 prompt 中。

## 5. 练习三：Secret、Observation 与日志脱敏

### Red

构造一个 fake connector，在请求 header、成功结果和异常信息中放入不同 canary。证明它们当前可能进入：

- model context capture。
- `AgentStep.input/output/errorMessage`。
- NDJSON `error` 或 `done`。
- Nest logger capture。
- trace span attributes。
- retry log。

### Green

- secret provider 在 executor 内部按 tenant/resource 注入凭证。
- ToolCall/Step 只存 connector id 和参数摘要。
- 结构化 redaction 先删除已知敏感字段，再使用 canary/模式扫描兜底。
- provider/tool 错误转换为稳定 code + 安全 message；原始 error 仅进入受控诊断通道且不含 request secret。
- oversized Observation 在 model/audit 视图分别截断并记录原始大小/hash。

### Refactor

- 把 `toModelObservation`、`toAuditSnapshot`、`toPublicError` 分开命名，防止误用同一个通用 sanitizer。
- 用类型品牌或不同 interface 阻止 raw output 直接传给 stream mapper。
- 不建立无法验证的“智能 PII 检测平台”。

## 6. 练习四：Quota reservation 与成本归因

### 6.1 状态模型

```text
AVAILABLE
  -> RESERVE(runId, estimatedMax)
  -> RESERVED
       -> SETTLE(actualUsage) -> CHARGED + RELEASE_REMAINDER
       -> ABORT/FAIL -> CHARGE_ACTUAL + RELEASE_REMAINDER
       -> RECOVERY -> RECONCILE
```

状态必须由 append-only 或等价可审计的 `UsageLedgerEntry` 支撑，不只在 `AgentRun` 上覆盖一个累计数字。reservation、model/tool usage、settlement、release 各有唯一 idempotency key；token/次数使用整数，金额使用 `costMicrounits` 等整数最小单位。

硬不变量：

```text
available >= 0
activeReservation >= 0
settled >= 0
settled + activeReservations + proposedReservation <= hardLimit
terminal(run) => activeReservations(run) = 0
same providerUsageEvent => at most one ledger effect
```

长 Run 每次准备发起新的付费 sampling/tool 前都要原子增量预留；不能只在 HTTP 入口检查一次。

### Red

- 两个并发 Run 都在余额 10 时通过“先读余额 >= 8”，最后使用 16。
- 同一 idempotency key 重放时重复 reservation。
- Run abort 后 reservation 永远不释放。
- tool 执行成功但 usage write 失败，重试导致重复扣费。
- provider 报告 usage 晚于 stream done，Run 已先完成。

### Green

- reservation 与可用余额更新处于一个数据库事务或原子语句。
- reservation key 与 canonical run/idempotency key 绑定。
- sampling/tool 每阶段用 provider request/event 唯一键追加增量 usage，终态统一 settle。
- abort/fail/recovery 都执行幂等 reconcile。
- 上游缺少精确 usage 时使用可解释的保守估算并标记来源。
- 对账发现 actual 超过 reservation 时进入显式 `OVERAGE_RECONCILIATION_REQUIRED`（名称以 ADR 为准）并阻止后续付费动作；禁止用负余额或覆盖历史 ledger 静默吸收。

### Refactor

- 先保留数据库实现；真实性能证据出现后再引入 Redis/token bucket。
- usage event 与 invoice/支付系统分开，本阶段不建设账单平台。
- 把预算拒绝作为正常 domain result，不当成 internal error。

## 7. 练习五：成员变更与长运行竞态

用 controllable fake tool 暂停执行：

1. Alice 发起 Run，授权通过。
2. 工具执行前暂停。
3. 移除 Alice 的 Tenant A membership 或禁用 connector。
4. 恢复 executor。

分别设计并证明策略：

- 高风险/写工具在真正副作用前重新授权。
- 只读短调用可使用 Run 开始时固定的 scope snapshot，或同样重新授权；必须明确选择。
- 等待 Approval 的 Run 必须在 decision 时重新校验。
- 子操作不可使用已过期 access token 作为唯一授权事实。

## 8. 测试矩阵

### 8.1 Authentication / ActorContext

| Case | 层级 | 期望 |
| --- | --- | --- |
| 无 token | HTTP contract | 401；不创建数据库事实 |
| 无效/过期 token | HTTP contract | 稳定 auth code；不调用模型 |
| user token | adapter unit | 只构造服务端 claims 中的 actor/tenant |
| body 伪造 userId/tenantId | integration | 被忽略或 DTO 拒绝 |
| service webhook 签名 | adapter integration | 映射到受限 service actor |
| requestId 透传 | unit | 只影响 trace，不改变 identity |

真实 adapter 另有不可跳过的 integration matrix：有效签名；错误 `iss/aud`；过期或尚未生效；未知/轮换 `kid`；不允许的算法；禁用用户；membership 撤销；JWKS 暂时失败时按有界缓存 fail closed。只 decode JWT 的实现一律视为失败。若走 cookie，还要增加 Secure/HttpOnly/SameSite 与 CSRF 策略测试。

### 8.2 Tenant resource isolation

| Resource/Action | 同租户 | 跨租户 | 无成员 | 管理员 |
| --- | --- | --- | --- | --- |
| Conversation create/list | allow | 只见自身 | deny | 按管理面规则 |
| Conversation get/update/delete | allow by role | deny | deny | 不默认全局 allow |
| Message list | allow | deny | deny | 审计访问 |
| AgentRun create/query/cancel | allow by role | deny | deny | 显式接口 |
| AgentStep timeline | allow | deny | deny | 脱敏视图 |
| export/delete tenant | admin only | deny | deny | 双重确认/审计 |

### 8.3 Tool authorization

| Case | 期望决策 | 执行次数 |
| --- | --- | ---: |
| 同租户只读工具 | ALLOW | 1 |
| 未启用工具 | DENY | 0 |
| 目标资源属其他租户 | DENY | 0 |
| 需要批准且批准 | REQUIRE_APPROVAL -> ALLOW | 1 |
| 需要批准但拒绝/过期 | terminal reject/expire | 0 |
| 原本无权限但用户点击批准 | DENY | 0 |
| tool args 伪造 tenant | validation/permission failure | 0 |
| membership 在等待中失效 | recheck -> DENY | 0 |

### 8.4 Redaction

| Sink | 原始 secret | 允许摘要 | 证明方式 |
| --- | --- | --- | --- |
| Model request | 不出现 | resource id/必要字段 | fake model capture |
| AgentStep | 不出现 | 字段白名单/hash/size | DB assertion |
| NDJSON | 不出现 | public error code | stream parser test |
| Logger | 不出现 | IDs/status/duration | logger capture |
| Trace | 不出现 | low-cardinality status | fake exporter |
| Approval summary | 不出现 | 用户可判断的动作摘要 | API snapshot |

### 8.5 Quota / cost

| Case | 期望 |
| --- | --- |
| 余额足够 | 原子 reservation 成功 |
| 余额不足 | 模型/tool 均不执行，返回稳定 reset/limit 信息 |
| 两个并发 reservation | 总预留不超过限额 |
| idempotency replay | 返回同一 reservation/run |
| abort | 结算 actual，释放 remainder |
| stale Run recovery | 幂等 reconcile |
| provider usage missing | 使用带来源标记的估算 |
| tool + model cost | 都归属同一 run/tenant/actor |
| provider usage event 重放 | ledger 只生效一次 |
| settle/release 重放 | 状态和余额不变 |
| terminal Run | active reservation 数为 0 |
| 增量动作将超过 hard limit | 动作执行次数 0，不产生负余额 |
| metrics export | 不含 tenantId/runId/actorId label；租户明细来自 ledger query |

### 8.6 数据生命周期

| Case | 期望 |
| --- | --- |
| 成员退出 | 后续访问立即拒绝 |
| 租户导出 | 只包含本租户 canonical data，敏感字段按策略处理 |
| 租户删除 | 关系顺序、软/硬删除和审计保留符合 ADR |
| retention job 重放 | 幂等，不删除其他租户 |
| migration 回滚窗口 | 新旧实例对 nullable/backfilled 字段兼容 |

## 9. 建议测试命名

```text
returns_not_found_when_actor_reads_foreign_conversation
does_not_create_run_when_conversation_is_out_of_scope
ignores_tenant_id_suggested_by_model_tool_arguments
approval_does_not_grant_missing_resource_permission
rechecks_membership_after_waiting_for_approval
never_exposes_connector_secret_to_model_input
redacts_raw_tool_error_before_agent_step_persistence
reserves_tenant_budget_atomically_for_concurrent_runs
never_exceeds_hard_limit_or_creates_negative_available_balance
deduplicates_provider_usage_events_in_durable_ledger
replays_quota_reservation_idempotently
reconciles_reserved_budget_after_stale_run_recovery
rejects_wrong_issuer_audience_and_rotated_jwt_keys
fails_closed_when_multi_tenant_mode_has_no_real_auth_adapter
```

## 10. 运行验证建议

根据实际落地文件选择最小命令，阶段收口至少包含：

```bash
pnpm prisma:generate
pnpm exec prisma validate
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api test
pnpm lint
git diff --check
```

若项目测试 script 名称不同，以 `package.json` 为准并在证据中写实际命令。安全验收还应运行一个专门的 adversarial suite，不能只依赖全量测试中偶然覆盖。

## 11. 手动演练

自动化测试通过后做一次演练：

1. 用 Tenant A 登录并创建会话、执行只读工具。
2. 捕获 conversation/run/call IDs 与 usage。
3. 切换 Tenant B，手工复用所有 A 的 ID 请求 read/update/delete/cancel。
4. 在 prompt 中要求模型“使用 tenant A 的 connector”。
5. 检查 HTTP/NDJSON、数据库、日志和 trace。
6. 并发发起超过限额的 Run。
7. 中断一个已 reservation 的 Run，执行 recovery/reconcile。

手动演练用于发现测试漏项，不替代测试。

## 12. 验收证据清单

### 12.1 设计证据

- [ ] ActorContext 构造边界与字段说明。
- [ ] 真实 JWT/OIDC adapter、claims/JWKS 策略；或明确记录只能运行 `SINGLE_USER_DEMO` 且 Phase 10 未完成。
- [ ] User/Tenant/Membership/Resource schema ADR。
- [ ] Authentication、Authorization、Approval、Isolation 决策图。
- [ ] secret/data classification matrix。
- [ ] durable usage ledger schema 与 quota reservation/settlement 状态图。

### 12.2 自动化证据

- [ ] Conversation/Message/Run/Step 每类资源至少一个跨租户 denial test。
- [ ] JWT/OIDC 签名、issuer/audience、时间、kid 轮换、禁用/撤销与 fail-closed integration tests。
- [ ] 模型/前端伪造 scope 测试。
- [ ] Approval 不提升权限测试。
- [ ] membership 变化竞态测试。
- [ ] canary secret 全 sink 扫描。
- [ ] 并发 quota reservation、hard-limit/非负余额、provider event/settlement replay 测试。
- [ ] abort/stale recovery 结算测试。

### 12.3 运行证据

- [ ] 同租户完整 Run 成功且记录 actor/tenant/usage。
- [ ] 跨租户请求在 model/tool 调用前被拒绝。
- [ ] denial 审计事件可关联 request/run，但不含敏感 payload。
- [ ] 配额耗尽返回稳定 code 和可理解恢复条件。
- [ ] 日志样本和 DB snapshot 未出现 canary secret。

## 13. 退出判定表

| Requirement | 强证据 | 不足证据 |
| --- | --- | --- |
| 多租户隔离 | 两租户负向 integration tests + scoped SQL/Prisma 条件 | UI 列表只显示自己 |
| 工具授权 | executor 前 policy test，执行次数为 0 | prompt 告诉模型不要越权 |
| Secret 隔离 | 多 sink canary assertions | 人工扫一遍日志 |
| Quota | 并发原子性测试 + recovery reconcile | 单请求余额判断 |
| Usage/cost | durable ledger + 幂等 provider event + 对账查询 | Prometheus tenant label 或 Run 覆盖累计值 |
| Authentication | 真实 JWT/OIDC adapter integration + production gate | fake token 或只 decode JWT |
| 审计 | actor/tenant/run/call/policy/result 可关联 | 一段自由文本日志 |
| 数据生命周期 | export/delete/retention fixtures | 文档写“支持 GDPR” |

任何一项只有“不足证据”，阶段状态最多是 `Verifying`，不能标记 `Completed`。

## 14. 复盘问题

### 概念

1. Authentication、Authorization、Approval、Isolation 各自在哪一层作决定？
2. 为什么 Approval 不能解决跨租户越权？
3. 为什么 requestId 不能充当 actorId？
4. shared-schema、多 schema、database-per-tenant 的取舍是什么？当前为什么选最小方案？

### 代码

5. 当前项目哪个裸 id 查询最危险？你如何让数据库条件携带 scope？
6. ActorContext 如何从 Controller 传到 AgentRuntime 和 ToolExecutor？
7. tool arguments 中的 resource id 如何重新解析为 tenant-scoped 资源？
8. raw ToolResult 为什么不能直接作为 Observation、AgentStep output 和 HTTP response 三用？

### 可靠性

9. 额度 reservation 后进程崩溃，如何避免永久占用或重复扣费？
10. 权限在 Approval 等待期间变化，执行时使用 snapshot 还是 recheck？为什么？
11. tool 成功但审计写入失败时，什么是 canonical fact？

### 取舍

12. 本阶段从 Codex sandbox 学到了什么，又明确没有移植什么？
13. 什么时候才值得引入 Redis rate limiter、集中 policy engine 或字段级加密？
14. 进入 MCP 前，还必须有哪些信任和隔离证据？

## 15. 阶段完成陈述模板

```md
Phase 10 已完成：可部署模式通过真实 JWT/OIDC（或等价）adapter 建立 ActorContext；所有 Conversation、Message、Run、Step 与 Tool 执行均以服务端 tenant scope 为权威；跨租户、伪造 scope、Approval 提权、secret 泄漏和并发额度均有自动化负向证据。durable usage ledger 满足 hard limit、非负余额、幂等入账与终态零 reservation 不变量，租户成本不依赖 Prometheus 高基数标签。当前没有实现 OS sandbox 或企业 IAM 控制台，因为这些能力不替代云端身份、数据与工具授权。

关键证据：...
剩余风险：...
进入 Phase 11 的条件：外部扩展必须复用同一 ToolPolicy、credential、quota、redaction 与 audit 边界。
```
