# Phase 10 源码阅读：从 Codex 工具安全到云端租户边界

## 1. 阅读目标

本阶段不是从 Codex 找“多租户实现”——Codex 是本地客户端 Agent，本地源码并不能替当前项目回答 tenant schema、共享数据库隔离和云端计费。阅读目标是提取三个可迁移设计：

1. policy decision、approval、execution isolation 为什么必须分层。
2. 一次工具执行为什么要携带稳定的 call/session/turn context，并产生可分类决策与结果。
3. permission profile、网络控制、凭证与 telemetry 如何在执行边界汇合，而不是散进每个工具。

然后回到当前项目，用 NestJS、Prisma 和云端 ActorContext 完成二次设计。

本路线基于本地 fork：`/Users/ayu/Desktop/codex`，快照 `626147f728`。路径是取证入口；若源码演进，应优先追踪符号职责，不机械依赖行号。

## 2. 阅读前先写假设

在打开 Codex 前先回答并保留初稿：

- 当前项目的可信身份从哪里来？答案若是 DTO 或 query 参数，说明尚无可信边界。
- 知道一个 `conversationId` 是否就能访问会话？
- ToolCall 中出现 `tenantId` 时，当前 executor 会相信谁？
- Approval 通过能否让无权访问资源的用户获得权限？正确答案必须是不能。
- 哪些数据会进入模型、AgentStep、日志和 NDJSON？四种视图是否相同？
- 并发创建两个 Run 时，额度检查能否原子化？

读完后用源码证据修正，而不是把 Codex 的类型名抄进 TypeScript。

## 3. Codex 阅读路线 A：工具执行的安全编排

### 3.1 入口文件

| 顺序 | Codex 文件 | 重点符号/职责 |
| --- | --- | --- |
| 1 | `codex-rs/core/src/tools/orchestrator.rs` | `ToolOrchestrator::run`，approval -> sandbox selection -> attempt -> classified retry |
| 2 | `codex-rs/core/src/tools/sandboxing.rs` | `ExecApprovalRequirement`、`ApprovalCtx`、`Approvable`、`ToolRuntime`、`ToolError` |
| 3 | `codex-rs/core/src/tools/sandboxing_tests.rs` | approval/sandbox 组合如何以测试保护 |
| 4 | `codex-rs/core/src/tools/network_approval.rs` | 网络访问的独立批准生命周期 |
| 5 | `codex-rs/core/src/network_policy_decision.rs` | 网络 policy 决策与 payload 映射 |

### 3.2 跟踪调用链

```text
tool-specific request
  -> ToolRuntime / Approvable
  -> exec_approval_requirement
       -> Skip | NeedsApproval | Forbidden
  -> request_approval when needed
  -> sandbox_override_for_first_attempt
  -> SandboxManager selects attempt
  -> tool.run(req, attempt, ToolCtx)
  -> classify result
  -> optional retry/escalation
  -> telemetry + final ToolError/output
```

### 3.3 必须观察的不变量

- `Forbidden` 与 `NeedsApproval` 不同：被策略禁止的调用不能通过“用户点同意”绕过。
- `ApprovalCtx` 同时保留 tool `call_id` 和 review lifecycle id，说明“被审查的动作”与“审查流程”不是同一 ID。
- `ToolCtx` 带 session、turn、call id 和 tool name，便于取消、通知、审计和 telemetry 关联。
- 批准缓存使用序列化 approval key，而不是“某工具永远允许”；批准范围必须可描述。
- sandbox 是批准后的另一个控制层，不因获得批准就自动消失。
- 网络批准有自己的开始/结束语义；外部访问不是普通函数调用的无条件副作用。

### 3.4 翻译到当前项目

| Codex 概念 | 云端项目的对应问题 | 不应照搬 |
| --- | --- | --- |
| `ExecApprovalRequirement` | ToolAuthorizationPolicy + ApprovalPolicy 的决策结果 | shell-specific prefix rule |
| `ApprovalCtx` | `tenantId/runId/callId/approvalRequestId` | 本地 Session 缓存作为 durable fact |
| `ToolCtx` | `ActorContext` + RunContext + AbortSignal + budget | Codex session/turn Rust 类型 |
| sandbox selection | credential scope、出站域名、timeout、response limit、worker isolation | OS sandbox 系统调用 |
| network approval | connector allowlist / egress policy / explicit consent | 本地代理实现 |
| telemetry | audit/trace 用 tenant/run 关联，Prometheus 只保留低基数 provider/operation/status 聚合 | tenant/run/actor 或 prompt/tool payload 高基数标签 |

## 4. Codex 阅读路线 B：Permission profile 如何成为执行上下文

### 4.1 入口文件

- `codex-rs/core/src/config/permissions.rs`
- `codex-rs/core/src/config/resolved_permission_profile.rs`
- `codex-rs/core/src/config/permission_profile_catalog.rs`
- `codex-rs/core/src/context/permissions_instructions.rs`
- `codex-rs/core/src/tools/handlers/request_permissions.rs`
- `codex-rs/core/src/config/permissions_tests.rs`

### 4.2 阅读问题

1. 配置中的权限声明如何编译成 runtime 可执行 policy？
2. file-system 和 network policy 为什么是不同维度？
3. 运行时传给模型的 permission instructions 与真正执行的 policy 有何区别？
4. 模型提出 permission request 是否代表它获得权限？中间还有哪些系统决策？
5. denied-read 限制为什么在“绕过 sandbox”时仍不能被无意丢弃？

### 4.3 云端翻译

当前项目中也应区分：

- **模型可见说明**：告诉模型哪些工具通常可用，仅用于改善选择。
- **服务端有效权限**：根据 actor、tenant plan、resource 和 parsed arguments 计算，是执行权威。
- **本次批准**：对一个确定 ToolCall 的显式同意。
- **执行隔离**：凭证、网络、超时、大小和并发限制。

模型看到“你可以读取站点分析”不等于 executor 可以跳过 tenant/resource 检查；这与 Codex 中 prompt instructions 不替代真正 sandbox policy 是同一个不变量。

## 5. Codex 阅读路线 C：敏感凭证与配置边界

### 5.1 建议入口

- `codex-rs/core/src/config/auth_keyring.rs`
- `codex-rs/core/src/config/auth_keyring_tests.rs`
- `codex-rs/codex-mcp/src/mcp/auth.rs`
- `codex-rs/config/src/mcp_types.rs`
- `codex-rs/config/src/mcp_requirements.rs`
- `codex-rs/core/src/mcp_tool_call/telemetry.rs`

### 5.2 只提取这些问题

- 凭证的存储/解析职责是否与 tool arguments 分离？
- MCP server 配置、认证状态和一次 tool call 如何关联但不互相泄漏？
- telemetry 记录哪些安全诊断字段，避免记录哪些 payload？
- auth 失败、tool 失败和 permission denial 是否可以区分？

### 5.3 当前项目应形成的结论

- connector credential 用 `(tenantId, connectorId)` 从服务端 secret provider 获取。
- ToolCall 只引用 connector/resource，不携带 secret。
- 日志和 Step 只记录 credential reference 或 fingerprint，不能记录原值。
- secret rotation 不应要求修改 prompt 或 ToolDefinition。

本阶段不需要深入 Codex keyring 的平台 API，也不需要复制 OAuth UI；重点是凭证生命周期与执行 payload 分离。

## 6. Codex 阅读路线 D：决策和失败的可观察性

建议在 `orchestrator.rs` 中追踪：

- `ReviewDecision` 从哪里产生、如何拒绝。
- `ToolDecisionSource` 如何区分配置、用户/guardian 等来源。
- `ToolError::Rejected` 与执行失败如何分开。
- approval requested counter 使用哪些标签。
- retry 为什么不能把第一次安全决策抹掉。

映射到当前项目时，审计事件至少应能回答：

```text
谁(actorId)
在什么租户(tenantId)
通过哪个入口(requestId/trigger)
对哪个 Run/call
请求什么工具和资源摘要
系统作出 allow / approval_required / deny 中哪种决策
依据哪个 policy version
最终是否执行、耗时和结果状态
```

审计记录不是模型 chain-of-thought，也不应保存完整 prompt 或 secret。

## 7. 当前项目反向阅读路线

Codex 每读完一层，立即回到当前仓库找缺口。

### 7.1 数据归属

| 当前文件 | 阅读重点 | 必须指出的缺口 |
| --- | --- | --- |
| `prisma/schema.prisma` | Conversation/Message/Run/Step 关系 | 无 User/Tenant/Membership 和资源 scope |
| `apps/api/src/conversations/conversations.service.ts` | create/list/update/delete 查询条件 | `id` 是唯一访问条件 |
| `apps/api/src/conversations/messages.service.ts` | 会话存在检查与消息列表 | 不知道调用者身份 |
| `apps/api/src/agent-runtime/agent-run-recorder.service.ts` | Run/Step 写入 | 无 tenant/actor/usage/policy metadata |

建议画出当前数据流，并用红色标记所有只接收裸 `conversationId` 的方法。

### 7.2 请求身份

| 当前文件 | 阅读重点 |
| --- | --- |
| `apps/api/src/common/bootstrap/register-app-globals.ts` | 全局 pipe/filter/interceptor/middleware 已注册什么 |
| `apps/api/src/common/middleware/request-id.middleware.ts` | requestId 的来源和传播范围 |
| `apps/api/src/conversations/conversations.controller.ts` | DTO/param 如何进入 service |
| `apps/api/src/seo/seo.controller.ts` | streaming 请求与连接关闭 |

问题：`requestId` 是追踪 ID，不是身份；不要因为已有 request middleware 就误判认证已完成。

反向阅读后必须选择并记录认证门槛：公开多租户路径接入真实 JWT/OIDC adapter（校验签名、issuer、audience、时间与 JWKS 轮换，并从数据库加载 membership），或者暂时只保留 production fail-fast 的 `SINGLE_USER_DEMO`。fake token 只能服务测试，不能作为“已有 Auth”的源码证据。

### 7.3 Runtime 与工具

- `apps/api/src/agent-runtime/agent-runtime.types.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- Phase 02-05 实际形成的 ToolDefinition/Registry/Policy/Approval 文件。

逐项检查：

- `RunTurnStreamInput` 是否携带可信 actor，而不是 `tenantId?: string` 的可选裸值？
- `assertConversationExists` 是否按 tenant scope 查询？
- history 查询是否有 tenant scope，还是只靠 conversation relation？
- tool executor 是否从 server context 取得 resource scope？
- error/step output 是否可能写入 secret？
- abort/recovery 后 quota reservation 是否结算？
- usage 是否进入带唯一 provider event id 的 durable ledger，还是只写 Run 累计字段/Prometheus label？
- hard limit、非负余额、terminal 零 reservation 是否有数据库级或并发测试证据？

## 8. 推荐阅读顺序

### 第一遍：90 分钟，建立边界

1. `tools/orchestrator.rs` 文件头和 `ToolOrchestrator::run`。
2. `tools/sandboxing.rs` 中 `ExecApprovalRequirement`、`ApprovalCtx`、traits。
3. 当前 `conversations.service.ts`、`messages.service.ts`、schema。
4. 画“Codex 本地安全层 -> 云端安全层”对照表。

### 第二遍：聚焦测试

1. `tools/sandboxing_tests.rs`。
2. `config/permissions_tests.rs`。
3. `tools/network_approval_tests.rs`。
4. 把每类 Codex test 转译成当前项目的一个负向安全 case。

### 第三遍：凭证和观测

1. auth keyring / MCP auth 的职责边界。
2. tool telemetry 字段。
3. 当前 AgentStep、错误 mapper 和 logger 路径。
4. 写安全数据流图与 canary secret 测试计划。

## 9. 可以跳过的细节

本阶段第一轮可以跳过：

- Seatbelt、Landlock、Windows sandbox 的系统调用细节。
- shell command prefix policy 的完整语法。
- guardian 模型内部提示和高级 review 策略。
- TUI 审批组件布局。
- keyring 各操作系统实现。
- Codex 本地账户套餐和 rate-limit UI。

跳过不等于这些能力不重要，而是它们不能替代当前阶段最紧迫的云端 tenant scope。

## 10. 源码阅读产物

阅读结束必须留下：

- 一张 Codex tool security 调用链图。
- 一张当前项目信任边界与数据流图。
- 一份 `Authentication / Authorization / Approval / Isolation` 术语对照。
- 一张所有 Prisma 查询入口的 scope 审计表。
- 一张 secret 从存储到 tool、model、step、log 的流向表。
- 至少十个跨租户或越权 Red 测试名称。
- 一段说明：为什么 Codex 没有直接提供当前项目的多租户答案。

## 11. Teach-back 问题

不看文档回答：

1. 为什么用户批准了一个工具，系统仍可能拒绝执行？
2. 为什么把 tenantId 写进 ToolCall schema 会造成错误的信任边界？
3. Codex 的 sandbox 在当前项目中最接近哪些云端控制，而不是哪个 TypeScript 类？
4. `requestId`、`actorId`、`tenantId`、`runId`、`callId` 各解决什么问题？
5. 如何用一条数据库查询而不是 controller if 判断证明租户隔离？
6. 一个 tool 成功但 usage 持久化失败时，安全和成本状态应如何收口？
