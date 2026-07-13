# Phase 13：生产化作品集收口

> 模块分类：**Advanced**。按当前项目成熟度选择性使用，不要求为“看起来完整”补齐所有高级能力。

## 阶段文件

- [README.md](./README.md)：Capstone 范围、目标架构、交付、运行与退出标准。
- [source-reading.md](./source-reading.md)：Codex 协议、Runtime、持久化、SDK 与测试的纵向阅读路线。
- [practice-and-acceptance.md](./practice-and-acceptance.md)：Clean-room、E2E、安全、故障、部署与最终证据审计。

## 1. 阶段定位

这一阶段不再引入新的 Agent 概念，而是把前述阶段整合成一个可运行、可演示、可测试、可部署、可解释的 AI SEO Agent 作品集。

“生产化”在本学习项目中的准确含义是：

- 对核心用户故事有完整闭环。
- 关键状态与失败可恢复、可观察。
- 安全和租户边界有负向证据。
- 自动化测试、评测和发布检查可重复。
- 新开发者按文档能在干净环境启动。
- 演示者能用真实 Run/Step/Tool/Approval 证据解释系统。

它不意味着已经达到大型企业的全部合规、SRE 或全球部署标准。文档必须明确已证明范围与剩余风险。

## 2. 核心问题

> 如何把 Conversation、AgentRun、ModelEvent、Tool loop、Approval、Context、Recovery、Streaming、Observability、Tenant Security 和可选扩展整合成一条用户可理解、工程师可复盘、自动化可证明的产品链路，并让源码、文档、部署与演示对同一事实负责？

## 3. 进入条件

- Phase 00-10 的核心能力全部有验收证据。
- Phase 11 若未进入产品路径，至少明确扩展实验的结论；Capstone 不强制依赖 MCP。
- Phase 12 有 GO/NO-GO 决策；只有 GO 才允许把 Multi-agent 放入默认或可选演示。
- 当前 `docs/tasks/`、`docs/roadmap.md` 和进度追踪与真实代码状态一致。
- 数据迁移、测试和 eval 可以在非开发者本机环境运行。
- 已选择一个受控部署目标和最低运行环境。
- 已选择真实浏览器可访问的 production-like edge（HTTPS + reverse proxy/ingress）；只在 localhost 或直接容器端口成功不满足部署验收。

不满足时，先回到相应 Phase 补证据；Capstone 不能靠 README 把未完成能力包装成完成。

## 4. 当前仓库需要特别收口的起点

基于当前快照，最终阶段必须重新核对而不能沿用旧描述：

| 现状 | 风险 | Capstone 动作 |
| --- | --- | --- |
| 根 `README.md` 仍描述早期 demo/阶段 2，并指向旧主看板 | 新读者得到错误状态 | 重写为当前产品与真实启动入口 |
| 根 package scripts 当前只有 dev/typecheck/lint/Prisma | 缺 test/build/eval/CI 统一入口 | 增加或记录真实可执行命令 |
| API package 当前无 build/test script | 部署产物和测试不可重复 | 补构建/测试策略并验证 clean build |
| 只有本地 docker-compose PostgreSQL | 部署、迁移、备份未证明 | 定义最小 deployment/runbook |
| `AgentRun/AgentStep` 尚无查询 UI（当前基线） | 架构价值无法演示 | 提供安全时间线/API 或 admin view |
| `.env` 存在本机配置 | 交付时有泄密风险 | secret scan，确保只提交 `.env.example` |
| 文档入口分层已重组 | 旧链接可能漂移 | 全仓库 link/status audit |

这些是阶段开始时的检查项，实际实现到 Phase 13 时必须重新用 live evidence 更新。

## 5. 产品叙事

### 5.1 目标用户

一个需要分析页面 SEO 问题、获取可解释建议并保留执行记录的站点运营者/前端工程师。

### 5.2 主用户故事

```text
用户登录并进入自己的租户
  -> 创建/打开 SEO Conversation
  -> 提交页面或站点审计问题
  -> Agent 构建受预算约束的 context
  -> 模型选择受授权的只读 SEO 工具
  -> 系统执行、记录 ToolCall/Observation
  -> 必要时为有副作用动作请求 Approval
  -> 模型基于证据给出最终建议
  -> 用户可查看 Run 时间线、来源、耗时与失败
  -> 刷新/断线/重启后仍能查询 canonical result
```

### 5.3 建议 Capstone 场景

**场景 A：技术 SEO 页面审计（主线）**

- 输入一个已归属当前 tenant 的页面资源。
- Agent 调用只读页面摘要/SEO 检查工具。
- 最终输出 findings、evidence 与 priority。

**场景 B：创建行动项（Approval）**

- 用户要求把建议保存为站点行动项或发送到受控外部系统。
- ToolPolicy 判定有副作用，生成 ApprovalRequest。
- reject 不执行；approve 重新授权后幂等执行。

**场景 C：中断与恢复**

- 运行中停止生成或断开连接。
- Message/Run/Step 到达正确终态。
- 重连后通过 query/resume 获取 canonical state。

**场景 D：多页面审计（仅 Phase 12 GO）**

- UI/配置显式选择 multi-page mode。
- 展示 parent-child 汇总，而非每个 child chain-of-thought。
- 能与单 Agent baseline 对比。

## 6. Capstone 能力边界

### 6.1 必须进入默认作品集

- Session Conversation 与持久化 Messages。
- 结构化 model events 与 NDJSON streaming。
- 单 Agent Tool loop，至少一个只读工具。
- Tool timeout/abort/error/Observation 与 Run/Step 记录。
- 至少一个 Approval 流程或明确的受控有副作用演示。
- Context budget、tool output normalization 与可解释 source。
- Idempotency、stale Run recovery、并发策略、reconnect/query。
- Trace/metrics/eval/regression。
- Authentication、tenant scope、Tool authorization、redaction、quota。
- 真实 JWT/OIDC（或等价）auth adapter；`SINGLE_USER_DEMO` 不能作为生产化多租户作品集完成证据。
- 自动化 tests、clean setup、deployment/runbook。

### 6.2 条件性进入

- MCP/Skill/Hook：只有 Phase 11 PoC 稳定且不会让 demo 依赖不可靠第三方时，作为“可选扩展”展示。
- Multi-agent：只有 Phase 12 GO，且 UI/成本/失败语义清楚时进入；否则在架构报告展示 NO-GO 研究价值。

### 6.3 不要求

- RAG/向量数据库。
- 任意代码执行与 OS sandbox。
- 公开插件市场。
- 通用 workflow engine。
- 多模型自动路由。
- 企业 SSO/SCIM 与正式计费。
- Kubernetes、多区域、无限水平扩展。

## 7. 目标架构

```text
Vue Web
  ├─ Conversation UI
  ├─ Approval UI
  ├─ Run Timeline / Evidence
  └─ reconnect + canonical reconciliation

NestJS API
  ├─ Auth / ActorContext / RequestId
  ├─ Conversation Application Service
  ├─ Agent Application Service
  ├─ Approval / Run Query endpoints
  └─ REST + NDJSON protocol mapper

Agent Core
  ├─ AgentTurnRunner / state machine
  ├─ ContextBuilder + budget
  ├─ ModelGateway + provider adapter
  ├─ ToolRouter / Registry / Policy / Executor
  ├─ optional Extension adapters
  └─ RuntimeEvent

Durability / Operations
  ├─ PostgreSQL canonical facts
  ├─ Run/Step/Tool/Approval repositories
  ├─ idempotency / lease / recovery
  ├─ trace / metrics / safe logs
  └─ eval / regression / retention
```

Controller 不实现 Agent loop，Vue 不推测 canonical terminal state，provider SDK 类型不泄漏到 runtime，NDJSON delta 不作为 durable fact。

## 8. 用户体验收口

### 8.1 Conversation

- 新建、列表、重命名、删除/归档行为与租户权限一致。
- optimistic user message 在服务器拒绝/重放时正确 reconciliation。
- 同一 Conversation active Run 冲突有明确 UI，不出现两个互相覆盖的 assistant bubble。

### 8.2 Streaming

- loading、first delta、tool waiting、approval waiting、done/error/aborted/reconnecting 状态可区分。
- 刷新或网络断开后从 server query 恢复，不永久显示 STREAMING。
- stop 按钮幂等；已完成后重复 stop 不改变结果。
- 不必显示所有内部 tool/hook events，但用户能看到有价值的“正在检查页面/等待确认”。
- 必须从真实浏览器经 HTTPS edge/reverse proxy 验证流式，而不是直接请求 API 容器：首个 delta 在 Run 完成前可见、代理不整段 buffering、长间隔不会被 idle timeout 提前切断、disconnect/cancel/reconnect 语义与 server canonical state 一致。

### 8.3 Approval

- 显示动作、目标资源、风险、参数安全摘要、过期时间。
- 不显示 secret 或让前端回传完整 ToolCall 作为事实。
- approve/reject/expire/cancel 都有清楚结果。
- 决策后 UI 从 server canonical approval/run state 更新。

### 8.4 Run Timeline

至少展示/查询：

- Run status、起止时间、模型/配置版本的安全摘要。
- sampling、tool、approval、context/recovery 等 Step。
- Tool name、状态、耗时、结果摘要和 evidence refs。
- token/tool usage 与 budget status（按用户能理解的粒度）。
- error code 与可采取动作，不展示内部 stack/secret。

Timeline 不是 chain-of-thought viewer。

## 9. 协议与兼容性收口

### 9.1 外部 API

- DTO validation 继续由全局 pipe 负责。
- Controller 返回业务数据，不重复包响应格式。
- NDJSON event union 有 version/compatibility 决策。
- 未知事件、提前 EOF、重复 terminal、重连 cursor 有 contract tests。
- error code 稳定，message 可本地化/演进。

### 9.2 内部 contract

- ProviderEvent、RuntimeEvent、TransportEvent 分层。
- ToolCall/Result/Observation/Approval 各有独立 ID 和 schema version。
- UI Message 与 model history/projected context 分开。
- Run snapshot 记录 prompt/model/tool/skill/policy/eval relevant versions。

### 9.3 未来入口

如果展示 cron/webhook，只允许调用同一个 Agent application/runtime：

```text
HTTP / Cron / Webhook
  -> trusted trigger adapter
  -> AgentApplicationService
  -> same runner/state/persistence
```

不在新入口复制 `LLMService.chatStream()`。

## 10. 数据与恢复收口

### 10.1 Canonical facts

明确数据库必须保存：

- resource ownership/membership。
- user-visible messages 与 terminal status。
- AgentRun、AgentStep、ToolCall/Observation summary。
- ApprovalRequest/decision。
- idempotency key、usage/budget、trace references。
- context summary/version 与 recovery checkpoint（如实际使用）。

不保存每个 token delta，也不保存 chain-of-thought。

### 10.2 Migration

- 从空库完整 migrate + seed/smoke。
- 从上一个发布 schema migrate。
- nullable -> backfill -> non-null 的多步迁移可与旧实例共存。
- rollback 只承诺已验证范围；破坏性 migration 有备份/恢复步骤。

### 10.3 Recovery

- 启动/定时 sweeper 识别 stale RUNNING/WAITING。
- 幂等 reconcile Message/Run/Step/Approval/Quota。
- grace shutdown 停止接收新 Run，等待或移交 active Run。
- DB 是 canonical，内存 registry/semaphore 丢失后可重建。

## 11. 安全收口

- 每个 resource query 使用 ActorContext + tenant scope。
- 管理面与用户面分开。
- ToolCall 不接受权威 identity/credential。
- Approval 后重新授权。
- model/log/step/trace/public response 使用不同安全投影。
- secret scan 覆盖 git tracked files、构建产物、日志 fixture。
- API 有 body/stream/tool result size limit。
- rate limit/quota 拒绝有稳定 code。
- quota/cost 来自 durable usage ledger 与 hard-limit 不变量；tenant/run 明细不用 Prometheus 高基数 label 表达。
- 外部 URL/connector 有 allowlist/SSRF 防护策略（若有 HTTP tool）。
- retention/export/delete 有最小演练。

## 12. 质量体系

### 12.1 测试金字塔

- Unit：mapper、router、schema、policy、context、budget、normalization。
- Runtime integration：fake model/tool/store，状态机 happy/fail/abort/retry。
- Database integration：transaction、tenant scope、idempotency、recovery races。
- API contract：DTO、response envelope、NDJSON、approval/query。
- Web unit/component：stream reducer、reconnect、approval/timeline state。
- E2E：主用户故事、跨租户 denial、abort/recovery。
- Eval：固定 SEO dataset 与 regression thresholds。

### 12.2 CI gates

建议按成本分层：

```text
每次 PR：format/diff-check -> typecheck -> lint -> unit -> contract
关键分支：DB integration -> web build -> E2E -> deterministic eval
发布前：migration rehearsal -> security/adversarial -> smoke -> backup/restore drill
```

真实命令由 package scripts 统一；文档不能列不存在的命令。

### 12.3 Test determinism

- CI 默认不用真实 LLM。
- fake provider/tool/clock/id generator 可控。
- 真实 provider smoke 独立、可跳过且有成本上限。
- eval 固定 model/version 或清晰记录漂移。
- flaky test 不能无限重试掩盖竞态。

## 13. 可观测性与运行目标

### 13.1 Dashboard/报告

- Run success/fail/abort/recovery rate。
- first token/total latency。
- sampling/tool/approval waiting duration。
- token/tool/cost per tenant/run。
- loop budget exceeded、stale recovery、quota deny。
- tool dependency error/timeout。

其中 per-tenant/per-run cost 来自 durable usage ledger/query 或离线报表；Prometheus 指标不得使用 `tenantId/runId/actorId` label，只按 provider、operation、plan tier、status 等受控低基数维度聚合。

### 13.2 最小 SLO（作品集范围）

根据本地/部署测试定真实值，不在文档编造。例如定义：

- 非 LLM API 健康请求可用率。
- Run terminal state eventual consistency 时间。
- stale recovery 最大检测窗口。
- stream reconnect 后 canonical state 恢复时间。

SLO 必须配测量方式和错误预算含义，否则只是一句口号。

### 13.3 Runbook

至少覆盖：

- provider 429/5xx 激增。
- DB 不可用或连接池耗尽。
- stale RUNNING 增长。
- quota/reservation 不一致。
- connector/MCP 故障（若启用）。
- migration 失败。
- secret 泄漏怀疑与 rotation。
- 恢复备份与验证。

## 14. 部署与环境

### 14.1 环境配置

- `.env.example` 只含变量名、安全示例和说明。
- 启动时验证必填配置，错误 fail fast。
- API Key 不进入 Web 构建。
- development/test/production 的 timeout、log、CORS、DB 策略明确。
- production 信任的 proxy hop/CIDR 明确；只有受信代理的 `Forwarded`/`X-Forwarded-*` 可影响 scheme/client IP，避免伪造 HTTPS 或绕过 rate limit。

### 14.2 构建

- Web 产出确定静态资源。
- API 有可运行的编译产物或明确的 production runtime。
- Prisma generate/migrate 与启动顺序可重复。
- clean checkout 不依赖开发者全局工具或已有 `node_modules`。

### 14.3 发布策略

- migration 与应用版本兼容。
- readiness 在关键依赖/迁移不满足时不接流量。
- graceful shutdown 与 active Run 策略明确。
- 发布后自动 smoke；失败有回滚/前滚步骤。
- 日志、备份、retention 和 secret rotation 有最小配置。

### 14.4 HTTPS edge 与 stream proxy gate

发布目标必须提供有效 TLS 证书与 hostname 校验，HTTP 重定向 HTTPS，生产 Cookie（若用）设置 Secure/HttpOnly/SameSite 并有 CSRF 策略；CORS 只允许明确 Web origin，认证 token 不放 query string。TLS 终止、应用 scheme 与 trusted proxy 配置必须一致。

reverse proxy/ingress 对 NDJSON 路径必须有专门配置与自动化证据：关闭响应 buffering/cache/transform（例如等价的 `proxy_buffering off`、`Cache-Control: no-store, no-transform`，具体语法按平台），read/idle timeout 大于服务端 heartbeat/最长允许间隔，及时 flush chunk，限制总连接时长/并发/请求体，并在 deploy drain 时停止新 Run、保留 canonical recovery。浏览器 parser 必须容忍代理重新分块，不能假设一个网络 chunk 等于一行 JSON。

验收至少包括：

1. 浏览器从公开 HTTPS origin 登录并创建 tenant-scoped Conversation。
2. 通过同一 edge 发起 NDJSON Run，记录首 delta 早于 terminal 的时间证据。
3. 人为制造跨 proxy idle 间隔、chunk 拆分/合并、client disconnect、cancel、refresh/reconnect。
4. 验证 TLS 错误/HTTP 明文/非允许 Origin 被拒绝，认证信息不出现在 URL、access log 和页面存储快照。
5. 验证 edge timeout/502/部署 drain 后 DB Run/Step/Quota 均能查询并收口，不留下假 STREAMING。

只有直接 API/Pod smoke、curl 一次性读完整响应或关闭 TLS 校验，均不能通过此 gate。

## 15. 文档与作品集材料

### 15.1 根 README

必须准确包含：

- 产品解决的问题与截图/演示入口。
- 当前真实能力与明确非能力。
- 架构总图。
- 环境要求与一键/最短启动步骤。
- 测试、eval、build、migration 命令。
- 安全提示和 demo data。
- 深度文档索引。

### 15.2 架构报告

- 从 Controller 到 Runtime/Model/Tool/Persistence 的调用链。
- Thread/Conversation、Run、Step、Message、ToolCall、Observation、Approval 术语。
- 状态机、数据模型与 trust boundaries。
- Codex 客户端与当前云端架构对照。
- 没有照搬 JSON-RPC、rollout、OS sandbox、Multi-agent 的取舍。

### 15.3 ADR / Runbook / Demo

- 关键 ADR：provider-neutral events、canonical state、tenant scope、approval、recovery、extensions/multi-agent decision。
- deployment/runbook。
- 5-10 分钟主 demo 脚本。
- 15-20 分钟技术 deep-dive 脚本。
- failure demo 与预期 evidence。

## 16. 实施任务拆分

### Task 13.1：Scope freeze 与差距审计

- 从目标逐项映射代码/测试/文档证据。
- 删除或延期非主线功能。
- 确定 conditional features（MCP/Multi-agent）是否进入。

### Task 13.2：主用户故事整合

- Conversation -> tool audit -> final answer。
- Approval write/reject/approve。
- stop/reconnect/recovery。
- Run timeline/evidence。

### Task 13.3：安全与失败演练

- 跨租户、伪造 scope、secret canary、quota race。
- provider/tool timeout、DB failure、crash recovery。
- 所有状态收口。

### Task 13.4：测试与 eval gate

- 统一 scripts。
- CI pipeline。
- deterministic eval/regression。
- clean environment test。

### Task 13.5：Build/Deploy/Operate

- production builds。
- migration rehearsal。
- deploy/smoke/readiness/shutdown。
- production-like HTTPS edge、trusted proxy/CORS/cookie 与 browser NDJSON streaming gate。
- backup/restore/runbook。

### Task 13.6：Docs 与演示

- README/architecture/ADR/runbook。
- screenshot/video 可选，但必须与当前版本一致。
- demo seed 与脚本。
- 技术复盘与剩余风险。

## 17. Red-Green-Refactor 总路线

### Red

- 从干净 clone 无法按 README 启动。
- 根文档描述不存在的阶段/命令。
- 主故事某一步只能手工改 DB。
- abort/reconnect/crash 留下非终态。
- timeline 暴露 secret 或 chain-of-thought。
- 跨租户可通过 ID 访问。
- CI 不覆盖 migration/eval/contract。
- deploy 后无法判断版本和健康。
- API 直连能流式，但 HTTPS edge buffering/idle timeout 让浏览器直到结尾才收到或留下假 STREAMING。

### Green

- 一条 clean setup + seed + smoke 路径。
- 主用户故事与关键失败 E2E。
- canonical query/timeline 与 safe projections。
- CI/build/migration/deploy/runbook 最小闭环。
- 真实浏览器经 HTTPS edge 的 auth/NDJSON/abort/reconnect 自动化 gate。
- 文档与代码、命令、截图实时一致。

### Refactor

- 只处理证据显示影响理解、测试或运行的结构债务。
- 不在作品集最后阶段大规模重写框架。
- 删除 unused experiment/feature flag，或明确隔离与结论。
- 把重复 demo setup 固化为 script/fixture，而非长手工步骤。

## 18. 明确非目标

- 不在收口阶段切换 Vue/NestJS/Prisma 技术栈。
- 不新增作为 Agent 产品能力、且未经前序 Phase 验证的 RAG、browser automation、通用代码执行；用于发布验收的浏览器 E2E 不属于此处非目标。
- 不为“生产感”堆 Kubernetes、Kafka、微服务。
- 不宣称未做的 compliance、HA、灾备等级。
- 不用漂亮 UI 掩盖状态机或安全缺口。
- 不把手动演示成功当作 automated acceptance。
- 不为追求功能数量保留失败的 Multi-agent/MCP 默认路径。

## 19. 退出标准

### 产品

- 主用户故事可从干净环境端到端运行。
- Approval、abort、reconnect/recovery 和 timeline 可演示。
- UI 只展示安全、用户相关的运行信息。

### 工程

- typecheck、lint、unit/integration/contract/E2E/eval/build 全部通过明确命令。
- migration 从空库和上一版本 rehearsal 通过。
- 所有 Run/Step/Message/Approval 在测试中最终 terminal。
- clean checkout 不依赖未记录手工状态。

### 安全

- tenant isolation、Tool authorization、Approval 不提权、secret canary、quota race 通过。
- 真实 auth adapter、TLS/CORS/trusted proxy/cookie-or-token storage gate 通过；单用户 demo 不冒充多租户生产模式。
- `.env`/日志/fixture/build output secret scan 通过。

### 运行

- deploy + smoke + readiness + graceful shutdown 有证据。
- browser 经 production-like HTTPS edge 的首 delta、proxy idle/chunk、disconnect/cancel/reconnect 与 TLS negative tests 有证据；直接容器 smoke 不算替代。
- stale recovery、backup/restore 和主要故障 runbook 至少演练一次。
- 版本、model/tool/prompt/policy/eval metadata 可追踪。

### 文档

- 根 README、docs 索引、roadmap/tasks/progress 与真实状态一致。
- 架构图、状态机、数据模型、取舍和剩余风险完整。
- 所有链接、命令和文件路径经自动或人工验证。

## 20. 阶段交付物

- 可运行的 AI SEO Agent Capstone。
- 主用户故事与失败 E2E evidence bundle。
- CI/release/migration/deployment 配置。
- eval dataset/report/regression gate。
- Run timeline/evidence UI 或安全查询视图。
- 根 README 与完整架构报告。
- ADR、runbook、demo scripts、剩余风险清单。
- Codex 架构学习到云端实现的最终对照报告。

## 21. 最终判断

Capstone 的完成标准不是“功能列表很长”，而是：

> 第一次接触仓库的人能按文档运行；用户能完成一个真实 SEO Agent 任务；工程师能从 trace、Run/Step/Tool/Approval 和数据库事实解释成功或失败；测试能证明关键不变量；部署故障有恢复路径；未完成和不适用的 Codex 能力被诚实说明。
