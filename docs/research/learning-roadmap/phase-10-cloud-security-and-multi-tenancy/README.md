# Phase 10：云端安全与多租户

## 阶段文件

- [README.md](./README.md)：阶段目标、威胁模型、目标架构与任务拆分。
- [source-reading.md](./source-reading.md)：Codex 安全编排源码与当前项目反向阅读路线。
- [practice-and-acceptance.md](./practice-and-acceptance.md)：Red-Green-Refactor、负向测试矩阵与验收证据。

## 1. 阶段定位

这一阶段把已经具备 Tool loop、可恢复 Run 和可观测性的单用户学习项目，提升为“所有资源访问都有服务端身份边界、所有消耗都能归属、所有工具都不能越权”的云端 Agent。

Codex 主要运行在用户本机：本地账户、本地工作区和本地审批构成其主要信任边界。当前项目运行在 NestJS 服务端，`Conversation`、`Message`、`AgentRun`、模型额度、外部工具凭证都由服务端托管。两者面对的威胁不同，因此本阶段学习 Codex 的原则与分层，不复制其 OS sandbox。

本阶段核心问题是：

> 当多名用户或多个租户共享同一套 Agent Runtime、数据库与模型账户时，系统如何保证身份不由模型或前端伪造、数据不串租户、工具权限不越界、秘密不进入模型上下文，并让额度与成本可追踪、可限制？

## 2. 进入条件

开始实现前必须用证据确认：

- Phase 07 已建立请求幂等、Run 恢复和副作用重试边界。
- Phase 09 已能用 `requestId -> conversationId -> runId -> stepId -> callId` 串联一次运行。
- 单 Agent Tool loop 的工具输入、Observation、错误和取消均有自动化测试。
- 中风险工具已经通过 Phase 05 的 Approval，而不是把“审批”误当成“鉴权”。
- 数据库迁移、测试数据库和最小集成测试可以重复运行。

如果这些条件不满足，只允许完成威胁建模、schema 草案和测试设计，不应直接把登录 SDK 或租户字段散落到业务代码。

## 3. 当前项目起点

当前代码的真实起点如下：

| 现有能力 | 当前证据 | 本阶段缺口 |
| --- | --- | --- |
| 会话资源 | `prisma/schema.prisma` 的 `Conversation` | 没有 `tenantId`、`ownerId` 或成员关系 |
| 消息资源 | `Message.conversationId` | 查询只按 `conversationId`，没有主体 scope |
| 运行记录 | `AgentRun` / `AgentStep` | 成本、身份、触发来源和租户归属不完整 |
| 会话 CRUD | `conversations.service.ts` | `findUnique({ id })` 可访问任意已知 ID |
| 消息查询 | `messages.service.ts` | 只验证会话存在，不验证调用者是否有权访问 |
| Runtime | `agent-runtime.service.ts` | 只接收 `conversationId`，没有可信 `ActorContext` |
| Request trace | `request-id.middleware.ts` | 已有 request id，但没有认证主体和租户关联 |
| 模型凭证 | 服务端环境变量 | 还没有日志、step、Observation 的统一脱敏策略 |
| 额度 | 无 | 没有用户/租户/provider 三层预算 |

这意味着“给 Controller 加一个 Guard”并不能完成本阶段。必须让 scope 进入查询、Runtime、工具执行和成本记录，并用负向测试证明跨租户访问失败。

## 4. 学习目标

完成后应能独立解释并证明：

1. Authentication 回答“你是谁”，Authorization 回答“你能对哪个资源做什么”，Approval 回答“这次高风险动作是否被明确同意”；三者不可互换。
2. 浏览器传来的 `userId`、`tenantId`、tool arguments 都不是权威身份来源。
3. `ActorContext` 只能由认证层构造，并沿应用层显式传播；模型永远看不到也不能覆盖权威 scope。
4. 数据库查询默认以 tenant scope 为条件，而不是先按 id 找到资源再在内存中补判断。
5. ToolDefinition 的风险元数据、租户启用策略和资源级授权在执行前统一决策。
6. secret、PII 与可公开业务数据有分类；进入模型、日志、step 和 Observation 前分别处理。
7. 用户、租户、provider 的 rate limit 与 budget 语义分开；所有模型和工具消耗归因到 `AgentRun`。
8. 多租户测试以“拒绝越权”为核心，不以“正常请求成功”替代安全证明。

## 5. 从 Codex 学什么

### 5.1 可迁移原则

Codex 的工具执行不是 handler 直接运行命令，而是经过 policy、approval、sandbox 和分类失败。当前云端项目应迁移以下原则：

- 权限决策独立于工具业务实现。
- 风险等级由系统定义，不能由模型自行降低。
- 批准只对明确的调用与参数有效。
- 执行上下文携带可信身份、取消信号、预算和审计关联。
- 工具结果进入 history、日志或持久化前必须经过安全投影。
- 失败要区分 permission denial、approval rejection、dependency failure 和 cancellation。

### 5.2 不直接照搬

- 不移植 Codex 的 macOS/Linux/Windows sandbox；当前阶段没有不可信 shell 或用户代码执行。
- 不把本地 `approval_policy` 当作云端 RBAC。
- 不把 ChatGPT 登录 token 当作本项目 tenant identity。
- 不复制本地文件路径授权；改为数据库资源、外部 connector 和租户凭证授权。
- 不为了“安全完整”一次性建设企业级 IAM 控制台、ABAC DSL 或 service mesh。

## 6. 威胁模型

先围绕资产、主体、入口与信任边界建模。

### 6.1 关键资产

- Conversation、Message、AgentRun、AgentStep 及其衍生报告。
- 租户专属 SEO 站点、关键词、分析数据和外部 connector 凭证。
- 平台模型 API Key、租户自带 provider key、webhook secret。
- Tool arguments、Observation、模型上下文和日志。
- 用户与租户额度、账单和成本明细。

### 6.2 主体

- 匿名请求。
- 已认证用户。
- 租户成员、租户管理员、平台管理员。
- API/cron/webhook 等机器主体。
- Agent Runtime 与 worker。
- 模型和外部 MCP/tool provider；它们是非可信建议源或依赖，不是授权主体。

### 6.3 最小攻击清单

| 攻击 | 示例 | 必须建立的控制 |
| --- | --- | --- |
| IDOR | 修改 URL 中的 conversationId 读取他人会话 | tenant-scoped query + 404/deny contract test |
| 身份注入 | Prompt 或 tool args 携带别人的 tenantId | server-side ActorContext，不接受模型 scope |
| 越权工具 | 普通成员要求执行管理员工具 | ToolAuthorizationPolicy |
| Prompt 注入取密钥 | 网页内容要求模型输出 API Key | secret 不进入 context；output redaction |
| 额度绕过 | 并发发送多个 Run 超过配额 | 原子 reservation / usage accounting |
| 日志泄密 | step input 保存完整 token | 分类、脱敏、大小限制与保留策略 |
| 跨租户缓存 | 以 URL 作为全局缓存 key | cache key 包含 tenant 和授权视图 |
| 管理面混用 | 普通 API 可传 role=admin | 管理入口和普通入口分离、重新鉴权 |

## 7. 建议架构

```text
HTTP / Webhook / Cron
  -> Authentication Guard / Signature Verifier
  -> ActorContextFactory
  -> Controller（只映射传输）
  -> Application Service
  -> TenantScoped Store / Repository
  -> AgentRuntime
       -> ToolAuthorizationPolicy
       -> QuotaService
       -> ModelGateway / ToolExecutor
       -> RedactionPolicy
       -> RunRecorder
```

### 7.1 ActorContext

建议由服务端生成项目自有类型，不把第三方认证 SDK 的 session 类型传遍业务层：

```ts
interface ActorContext {
  actorId: string
  tenantId: string
  actorType: 'user' | 'service'
  roles: readonly TenantRole[]
  requestId: string
}
```

不把 access token、完整 claims 或 provider credential 放入该对象。Controller 从认证 request 中取得它，应用服务和 Runtime 显式接收它；任何内部入口（cron/webhook）也必须创建等价的机器主体，而不是传 `undefined` 绕过鉴权。

认证实现必须有一个不能含糊的运行模式门槛：

- **多租户/可部署模式**必须接入真实认证 adapter。推荐验证 OIDC/JWT：按受信 issuer 的 JWKS 校验签名与算法，校验 `iss`、`aud`、`exp`、`nbf` 和 token 类型，再把不可变 `sub` 映射到本地 User；tenant membership/role 由服务端数据库加载，不能直接相信 token 或请求 body 自报的角色。只做 Base64 decode、只检查“有 Authorization header”或接受前端传 `userId` 都不算认证。
- **尚未接入真实 adapter 时**只能显式运行 `SINGLE_USER_DEMO`（名称以实现 ADR 为准）：固定本地 demo actor、禁止租户切换/外部管理入口，并在 production 环境或公开监听配置下 fail fast。该模式可以继续学习 Tool loop，但不得宣称 Phase 10 多租户安全已完成。
- fake authenticator 只用于 unit/integration fixture；它证明授权逻辑，不证明真实 token 验证链。

真实 adapter 的 contract test 至少覆盖合法 token、错误 issuer/audience、过期/not-before、未知 `kid`/轮换 JWKS、签名算法不匹配、用户已禁用和 membership 已撤销。JWKS 拉取失败必须有有界缓存与 fail-closed 语义，不能退化为“解码后继续”。

### 7.2 数据模型顺序

建议先做最小 shared-schema 多租户，不在学习阶段上 database-per-tenant：

```text
Tenant
  -> TenantMembership <- User
  -> Conversation
       -> Message
       -> AgentRun
            -> AgentStep
```

设计决策：

- `Conversation.tenantId` 是首个 canonical scope。
- 子资源可通过 Conversation 关系验证租户；若高频查询或成本统计需要，可在 `AgentRun` 冗余 `tenantId`，但需由服务端写入并由一致性测试保护。
- `ownerId` 与 `tenantId` 解决不同问题：owner 表达创建者/个人资源，tenant 表达数据隔离边界。
- 迁移旧数据时创建明确的默认 tenant，并记录 backfill 证据；不可把 nullable tenant 长期留作绕过通道。

### 7.3 Tenant-scoped query

危险写法：

```ts
findUnique({ where: { id: conversationId } })
```

目标语义：

```ts
findFirst({
  where: {
    id: conversationId,
    tenantId: actor.tenantId,
  },
})
```

更新与删除也要把 scope 放进数据库条件。不要先读资源、再把未经条件保护的 `update({ id })` 作为第二步；并发期间资源归属或状态可能变化。若 Prisma API 限制写法，应使用复合唯一键、`updateMany` + affected count 或事务重新验证。

### 7.4 Tool authorization

建议的决策输入：

```ts
interface ToolAuthorizationInput {
  actor: ActorContext
  runId: string
  toolName: string
  risk: ToolRiskMetadata
  parsedArguments: unknown
  targetResource?: ResourceRef
}
```

执行顺序：

1. Registry 解析系统注册的 ToolDefinition。
2. 运行时 schema 校验参数。
3. 从 ActorContext 与服务端数据推导目标资源 scope。
4. 检查租户是否启用工具、角色是否允许、资源是否属于租户。
5. 若 policy 需要，再进入 Approval；批准不能替代第 4 步。
6. 预留额度并执行。
7. 对 Observation、step snapshot 和日志分别生成安全视图。
8. 结算实际 usage；失败或取消按策略释放未使用 reservation。

### 7.5 Secret 与数据投影

至少区分四个去向：

| 去向 | 允许内容 | 默认禁止 |
| --- | --- | --- |
| Model context | 完成任务所需的最小业务数据 | token、连接串、原始凭证 |
| Tool runtime | 由 secret provider 注入的 scoped credential | 从模型 arguments 传 credential |
| AgentStep / audit | tool 名、参数摘要、结果摘要、错误 code | 完整响应、cookie、Authorization header |
| 应用日志/trace | ID、耗时、状态、大小 | prompt 全文、Observation 全文、API Key |

Redaction 必须是结构化字段策略与兜底字符串扫描的组合；只用正则无法证明安全，只靠“开发者记得不要 log”也不可验收。

### 7.6 Quota 与成本

三层限制不要合成一个数字：

- 用户层：防止单个成员滥用。
- 租户层：订阅计划、共享预算和工具启用范围。
- provider 层：保护平台上游账户与速率限制。

预算至少覆盖：sampling 次数、input/output token、tool call 次数、外部付费 API cost、Run wall-clock time。长 Run 需要运行中检查，不能只在 HTTP 入口检查一次。

推荐 reservation 语义：Run 开始前原子预留上限；执行过程中累计 actual usage；终态结算差额。第一版可使用数据库事务，不要在没有真实吞吐前引入分布式 rate-limit 基础设施。

Quota 不是 Prometheus 计数器，而是需要恢复和对账的业务事实。至少建立 durable usage ledger：每条模型 sampling、tool/API 花费、reservation、settlement、release 都有 `tenantId/actorId/runId/source/quantity/unit/costMicrounits/idempotencyKey/occurredAt`，金额使用整数最小单位，禁止浮点累计。provider 返回的 usage 只能以唯一 provider request/event id 幂等入账。

必须把以下规则写成数据库约束、事务条件或 invariant tests，而不是“通常不会超”：

1. 同一 Run/idempotency key 只能有一个有效 reservation；settle/release 可重放但只生效一次。
2. `reserved >= 0`、`settled >= 0`，且任何扣减都不能让账户 available balance 变负。
3. 在发起下一次 model/tool 付费动作前，`settled + active reservations + proposed reservation <= hard limit` 必须在同一原子条件中成立；失败时执行次数为 0。
4. actual usage 不得静默超过已保留上限：长 Run 在每轮前增量预留；若上游只能事后给 usage，使用保守上界，并把异常 overage 记入单独对账状态、立即阻止后续动作，而不是篡改余额掩盖。
5. terminal Run 不得保留 active reservation；stale recovery、abort 和重复 webhook 都必须收敛到同一 ledger 结果。

Prometheus/OTEL metrics 只做聚合运行观测。不要把 `tenantId`、`runId`、`actorId` 作为 Prometheus label；按租户/Run 的成本查询来自 ledger，指标只使用 plan tier、provider、operation、status 等受控低基数维度。

## 8. 实现任务拆分

### Task 10.1：身份与资源模型

- 决定最小 User/Tenant/Membership schema 与角色。
- 为旧数据设计 backfill 和非空切换。
- 定义 `ActorContext`，只允许认证层构造。
- 实现并验证真实 JWT/OIDC adapter；若暂时只有单用户 demo，则增加 production fail-fast gate，并把 Phase 10 状态保持为未完成。
- 为 Web、cron、webhook 入口分别写身份来源说明。

### Task 10.2：查询收口

- 盘点所有 Conversation/Message/Run/Step 读写入口。
- 把 scope 传到 service/store，不允许 controller-only check。
- 为 list/get/update/delete/stream 分别写同租户与跨租户测试。
- 统一“资源不存在”和“无权访问”的外部响应，避免枚举资源。

### Task 10.3：工具授权

- 在 tool metadata 中保留 risk/sideEffect/approval requirements。
- 引入独立 policy 决策，不把角色判断散到 executor。
- 证明模型参数里的 tenantId/userId 被忽略或拒绝。
- 证明 Approval 通过后仍会重新授权。

### Task 10.4：安全投影与凭证

- 定义 context、tool、step、log 四种视图。
- 为 connector credential 建立按租户读取的 server-side provider。
- 对错误、Observation 与审计快照设置大小和脱敏策略。
- 增加 canary secret 测试，证明关键输出路径不泄漏。

### Task 10.5：配额与归因

- 定义 durable usage ledger、唯一幂等键、整数计费单位和 Run 聚合字段。
- 建立用户/租户/provider 三层检查顺序。
- 处理并发 reservation、失败释放、取消结算、provider usage 重放和对账异常。
- 用事务/约束保护 hard-limit 不变量；按 tenant/run 的明细从 ledger 查询，不在 Prometheus 指标中增加 tenant/run 高基数标签。

### Task 10.6：部署安全基线

- 验证 schema migration 的向前/向后兼容窗口。
- 明确 active Run 的 graceful shutdown / recovery 策略。
- 为 DB、provider、connector health 区分 liveness 与 readiness。
- 写出 secret rotation、审计保留、租户删除与数据导出最小流程。

## 9. Red-Green-Refactor 总路线

### Red

- 用两个租户 fixtures 证明当前按 id 查询会串数据。
- 用伪造 `tenantId` 的 ToolCall 证明当前 runtime 没有权威 scope。
- 用并发 Run 证明“入口先查余额再扣费”会超卖。
- 用 canary secret 证明当前错误/step/log 路径可能泄漏。

### Green

- 建立 ActorContext 和 tenant-scoped 查询。
- 为一个只读 SEO 工具接入最小 authorization policy。
- 实现结构化 redaction 和单事务 quota reservation。
- 让所有失败返回稳定 error code，并写入安全审计摘要。

### Refactor

- 只有当多个 service 重复 scope 条件时再提取 store helper/repository。
- 只有多个工具共享 policy 规则时再整理策略组合，不先做 DSL。
- 只有真实高并发证明数据库 reservation 成为瓶颈时再评估 Redis。

## 10. 明确非目标

- 不实现通用企业 IAM、SCIM、SAML 管理后台。
- “不做企业 IAM 控制台”不等于可以跳过真实认证；公开多租户模式仍必须有可验证的 JWT/OIDC 或等价 adapter。
- 不实现任意用户代码执行或 OS sandbox。
- 不接入大量外部 connector；只用一个受控工具证明授权链。
- 不把所有数据做字段级加密；先完成传输、静态存储与 secret 隔离基线。
- 不用前端隐藏按钮代替后端授权。
- 不让租户自行上传任意 ToolDefinition 或 hook。
- 不在本阶段启动 Multi-agent；父子权限继承留到 Phase 12。

## 11. 退出标准

只有以下证据全部成立才可进入 Phase 11：

- 两个租户之间的 Conversation、Message、Run、Step 读写均有负向自动化测试。
- 可部署模式已用真实 JWT/OIDC（或等价）adapter 完成签名、claims、轮换与撤销测试；若仍是 `SINGLE_USER_DEMO`，本阶段不能标记 Completed。
- 所有业务入口都能追溯到认证层生成的 ActorContext。
- 工具执行前重新校验租户、角色和资源，模型/前端无法覆盖 scope。
- Approval 不会提升原本没有的权限。
- canary secret 不出现在 model input、NDJSON、step snapshot、错误响应和日志样本中。
- 并发额度测试证明 hard limit 不超卖；reservation/settlement/release ledger 可幂等恢复并归因到 tenant、actor 和 run，且 Prometheus 不使用 tenant/run 高基数标签。
- 租户删除/导出/保留策略有最小可运行验证或明确演练记录。
- `pnpm --filter @agent/api typecheck`、相关 tests、`pnpm lint` 与 Prisma 验证通过。

## 12. 阶段交付物

- 身份与信任边界图。
- User/Tenant/Membership 与资源归属 ADR。
- ActorContext 与 tenant-scoped store contract。
- Tool authorization decision table。
- secret/data classification 与 redaction policy。
- quota reservation / settlement 状态图。
- 跨租户、凭证泄漏、并发额度自动化测试证据。
- 一份“为什么没有照搬 Codex OS sandbox”的云端迁移说明。

## 13. 关键取舍

本阶段成功的标志不是“项目有登录页面”，而是：

> 任意一次 Run 的身份、数据范围、工具权限、凭证来源和成本归属都由服务端事实决定；攻击者即使控制 prompt、URL 参数和模型 ToolCall，也不能访问其他租户资源或扩大权限。
