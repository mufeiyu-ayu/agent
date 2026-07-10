# Phase 13 练习与验收：从干净环境证明完整作品集

## 1. 验收原则

Capstone 只接受可复核证据：

- 文件存在不等于功能完成。
- typecheck 通过不等于状态机正确。
- 手动成功一次不等于可靠。
- UI 截图不等于 tenant security。
- 监控图不等于 canonical state 可恢复。
- 文档写了命令不等于命令在干净环境可运行。

每项 requirement 必须登记：代码入口、自动化测试、运行证据、剩余风险和负责人可重复步骤。

## 2. Scope freeze 练习

创建 Capstone scope 表，不允许收口中继续无限加功能：

| Capability | 必须/条件/不做 | 前置 Phase | 当前证据 | 缺口 | Capstone action |
| --- | --- | --- | --- | --- | --- |
| Conversation/Message | 必须 | 1-3 |  |  |  |
| Runtime/Run/Step | 必须 | 4 |  |  |  |
| Tool loop | 必须 | 1-4 |  |  |  |
| Approval | 必须 | 5 |  |  |  |
| Context/recovery/resume | 必须 | 6-8 |  |  |  |
| Observability/eval | 必须 | 9 |  |  |  |
| Tenant security | 必须 | 10 |  |  |  |
| MCP/Skill/Hook | 条件 | 11 |  |  |  |
| Multi-agent | 仅 GO | 12 |  |  |  |
| RAG/code execution | 不做 | - | - | - | 明确说明 |

冻结后新想法进入 backlog，不挤占 exit gates。

## 3. 练习一：Clean-room bootstrap

### 3.1 环境

使用一个新的临时目录/容器/CI runner：

- 只 checkout tracked files。
- 没有已有 `node_modules`。
- 没有已有数据库 volume/生成 client/build output。
- 只使用 README 声明的 Node/pnpm/Postgres。
- 使用专门测试/demo key，不使用开发者真实 secret。

### 3.2 步骤

1. 按 README 安装依赖。
2. 从 `.env.example` 创建测试配置。
3. 启动 PostgreSQL。
4. generate/migrate/seed。
5. build API/Web。
6. 启动服务。
7. 调用 health/readiness。
8. 执行 smoke user story。
9. 运行 tests/eval。

### 3.3 Red

记录所有隐性依赖：不存在的 script、旧 docs 路径、未生成 Prisma、CORS/port、API build 缺失、seed 不幂等、README 仍称当前阶段 2 等。

### 3.4 Green

- 修正唯一权威 README 与 scripts。
- 必填配置启动时 fail fast。
- seed/smoke 可重复。
- build 产物不依赖开发机器绝对路径。

### 3.5 Refactor

把重复手工步骤固化成最少的 package scripts/fixture；不要再造复杂 bootstrap framework。

## 4. 练习二：主用户故事 E2E

### 4.1 Scenario A：只读 SEO Audit

```text
Given Alice 属于 Tenant A，页面 pageA 已绑定
When Alice 创建 Conversation 并请求审计 pageA
Then 创建一次 canonical user Message + root AgentRun
And 模型第一轮产生受控 ToolCall
And tool 按 tenant scope 读取 pageA
And Observation 与 callId 配对进入第二轮 sampling
And 最终 assistant Message/Run/Steps 全部 COMPLETED
And timeline 可看到安全 evidence/usage
```

强断言：模型第二轮 input capture 含 Observation；不只断言最终文本包含某关键词。

对每条 finding 的 `evidenceRefs` 做完整性断言：引用存在、属于当前 tenant/run/tool observation、safe snapshot hash/schema 匹配；未知、跨租户或 dangling ref 不能进入最终回答或 Timeline。

### 4.2 Scenario B：Approval

```text
Given 工具 create_action_item 有副作用
When Agent 提出调用
Then Run/Step 进入等待语义并生成 ApprovalRequest
When Alice reject
Then executor invocation count = 0，Run 安全收口/继续回答

When 新 Run 中 Alice approve
Then server 重新加载 call、actor、policy
And 幂等执行一次
And decision/tool/result 可审计
```

同时测试过期、重复 decision、membership 在等待期间撤销。

### 4.3 Scenario C：Abort/Reconnect/Recovery

- sampling 中 abort。
- tool 中 abort。
- stream transport 断开但 server Run 继续/取消（按 Phase 08 选择）。
- 页面刷新后 query canonical state。
- 服务在 RUNNING 时重启，sweeper/resume/reconcile。

强断言：Message/Run/Step/Approval/Quota 均无永远非终态记录。

### 4.4 Scenario D：Multi-agent（条件）

只有 Phase 12 GO 才执行：parent/children isolated、bounded、cancel/recovery、structured aggregation，且输出标记 experiment/version。

## 5. 练习三：Adversarial security suite

### 5.1 Tenant isolation

Tenant B 尝试复用 Tenant A 的：

- conversationId。
- messageId。
- runId/stepId。
- approvalId。
- tool resource/pageRef/connectorId。
- reconnect/resume cursor。
- export/delete endpoint。

对 read/update/delete/cancel/approve 分别断言 deny、无副作用、无信息枚举。

### 5.2 Prompt/tool injection

- user prompt 自报 admin/tenantId。
- page content 指示泄漏 secret 或调用其他 connector。
- ToolCall arguments 注入 userId/tenantId/credential。
- MCP annotation/skill instructions 自报 trusted（若启用）。
- hook rewrite 到其他 tenant（若启用）。

系统必须以 server ActorContext/resource/policy 为权威。

### 5.3 Secret canary

把不同 canary 放入：provider key、connector token、tool raw output、provider raw error、webhook secret。搜索：

- model request capture。
- HTTP/NDJSON。
- Message/Run/Step/Approval DB snapshots。
- logs/traces/metrics labels。
- Web DOM/local storage。
- build output/test artifacts。

每个 sink 都要有明确允许/禁止规则。

### 5.4 Resource abuse

- 超大 user input。
- 超大 tool schema/output。
- 无限 tool loop 请求。
- 并发 Run/Approval spam。
- quota 边界竞态。
- slow client/stream backpressure。

断言 limits、error code、terminal state 与系统仍可服务其他 tenant。

### 5.5 真实认证与 Web 边界

- 多租户作品集必须从浏览器经过真实 JWT/OIDC（或等价）adapter；错误签名/issuer/audience/expiry/kid、撤销 membership 均在模型调用前拒绝。
- 若仍运行 `SINGLE_USER_DEMO`，production/公开 edge 必须 fail fast，Capstone 不能标记完成。
- 通过 HTTPS edge 验证 CORS、trusted proxy、Cookie Secure/HttpOnly/SameSite + CSRF（若 cookie auth）或 Authorization token 不落 query/localStorage/access log。

## 6. 练习四：Failure injection

### 6.1 Provider

- timeout、429、5xx、malformed chunk、提前 EOF、usage 缺失。
- abort 前/中/terminal 后。
- retryable/non-retryable 分类。

### 6.2 Tool/Connector

- validation、permission、approval reject、timeout、dependency、oversized、malformed result。
- 外部副作用成功但 observation persistence 失败。
- idempotency replay。

### 6.3 Database

- create user message 后、create Run 前失败。
- assistant Message 后、attach Run 前失败。
- tool success 后、Step complete 前失败。
- final Message 后、Run complete 前失败。
- connection pool unavailable。

### 6.4 Process/Deployment

- SIGTERM/graceful shutdown during active Run。
- hard crash + restart recovery。
- migration partially applied/old instance overlap。
- readiness dependency failure。

对每个 injection 填写：canonical state、用户响应、retry/recovery、usage settlement、审计事件。

## 7. 练习五：Protocol contract

### 7.1 NDJSON

测试：

- `start -> delta* -> done`。
- `start -> error`。
- `start -> delta* -> aborted`。
- tool/approval progress（若外部暴露）的版本兼容。
- chunk 分割跨 JSON 行。
- 多行同 chunk。
- 空行/未知 type/非法 JSON。
- 提前 EOF。
- duplicate terminal。
- reconnect 后 event replay/cursor 去重。

### 7.2 REST

- DTO transform/validation 使用全局 pipe。
- success envelope 使用 interceptor。
- error envelope/filter 不泄漏 stack/secret。
- idempotency header/body contract。
- run/approval query/cancel/decision auth scope。
- pagination/cursor tenant scope。

### 7.3 Web reducer

- optimistic message 与 server IDs reconcile。
- duplicate/late/out-of-order events。
- terminal event 后 delta 被忽略/审计。
- conversation switch 不串流。
- refresh/reconnect 恢复。
- approval UI 重复提交。

## 8. 测试矩阵总表

| 层 | 核心对象 | Happy | Failure | Race/Recovery | Security |
| --- | --- | --- | --- | --- | --- |
| Unit | Model event adapter | text/tool/done | malformed/error | chunk order | no raw secret |
| Unit | Tool router/registry | known call | unknown/schema | duplicate call | namespace/policy |
| Unit | Context | budgeted history | oversize | compaction retry | redaction |
| Unit | Policy | allow/approval/deny | invalid resource | membership change | no model scope |
| Runtime integration | Agent loop | tool -> observation -> final | provider/tool fail | abort/loop budget | safe errors |
| DB integration | Run/Step/Approval | terminal writes | transaction fail | idempotency/stale | tenant scope |
| HTTP contract | REST/NDJSON | valid stream/query | invalid/EOF | reconnect/replay | auth/IDOR |
| Web | workspace/approval/timeline | render/update | error/empty | refresh/switch | no sensitive view |
| Browser edge E2E | HTTPS auth + NDJSON | first delta before terminal | TLS/CORS/502/idle | disconnect/cancel/reconnect/drain | token not in URL/log/storage |
| E2E | user story | audit/approve | reject/timeout | restart/recover | cross-tenant/evidenceRef integrity |
| Eval | SEO tasks | quality | tool misuse | version comparison | unsafe action refusal |

## 9. 建议测试命名

```text
completes_a_tool_augmented_seo_run_with_paired_observation
rejects_side_effect_tool_without_approval
reauthorizes_approved_call_before_execution
reconciles_stream_ui_from_canonical_run_after_refresh
recovers_stale_run_without_repeating_completed_side_effect
never_leaves_nonterminal_steps_after_abort_or_failure
denies_cross_tenant_access_to_run_timeline_and_approval
does_not_expose_secret_canaries_in_any_public_or_observability_sink
reserves_quota_atomically_under_parallel_run_requests
migrates_clean_database_and_previous_schema_fixture
starts_from_clean_checkout_using_documented_commands
passes_deterministic_seo_eval_regression_thresholds
streams_first_delta_through_https_edge_before_run_terminal
survives_proxy_chunk_reframing_idle_disconnect_and_reconnect
rejects_plain_http_invalid_tls_untrusted_proxy_and_disallowed_origin
rejects_cross_tenant_dangling_or_hash_mismatched_evidence_refs
```

## 10. Eval gate

### 10.1 Dataset dimensions

- tool needed / not needed。
- correct tool selection。
- argument correctness。
- Observation grounding。
- final answer SEO correctness/coverage。
- evidence citation/ref accuracy。
- dangerous/unauthorized action refusal。
- context truncation/summary continuity。
- tool dependency failure graceful degradation。

### 10.2 Version metadata

每次结果保存：

- dataset/evaluator version。
- model/provider/version。
- system/developer prompt version。
- ToolDefinition/executor version。
- skill/MCP/plugin version（若用）。
- policy/context algorithm version。
- timestamp 与 seed/temperature 等可控参数。

### 10.3 Gate

定义 overall + critical subsets。安全拒绝、跨租户和副作用工具不能被 overall 平均分掩盖；这些使用 must-pass gate。

## 11. Build 与 migration 验收

### 11.1 命令清单模板

最终只登记真实存在且运行过的命令：

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm exec prisma validate
pnpm <migration-command-for-target-environment>
pnpm typecheck
pnpm lint
pnpm test
pnpm eval
pnpm build
pnpm smoke
```

若 workspace 使用细分 scripts，根脚本应统一或 README 精确列出。不可保留占位命令。

### 11.2 Migration rehearsal

- empty DB -> latest。
- previous release fixture -> latest。
- old app + intermediate schema compatibility（若滚动部署）。
- new app + intermediate schema。
- backfill 数量/耗时/失败恢复。
- backup before destructive change。

输出 schema version、row counts、constraints 和 smoke result。

## 12. Deployment smoke

部署后自动检查：

1. `/health`：进程存活。
2. `/ready`：DB/migration/关键配置可用。
3. authenticated create/list Conversation。
4. fake/sandbox model 的最小 Run 或低成本真实 smoke。
5. Run terminal/query。
6. metrics/log/trace 关联。
7. build/version/commit metadata。

smoke 使用专门 tenant，数据可清理且不影响真实额度。

上面是服务存活 smoke，不足以证明浏览器流式交付。发布 gate 还必须使用真实浏览器（Playwright 或等价）从 production-like 公开 HTTPS origin 经过 DNS/TLS/reverse proxy/ingress：

1. TLS 证书 hostname/有效期/链验证通过；HTTP 明文重定向或拒绝，测试不得关闭证书校验。
2. 用真实 auth adapter 登录/获取授权，创建当前 tenant Conversation；非允许 Origin、伪造 forwarded headers 和跨租户 ID 被拒绝。
3. 发起 NDJSON Run，采集 `request sent -> first delta -> terminal` 时间，强断言 first delta 早于 terminal，证明 proxy 未整段 buffering。
4. fake provider 在两个事件间暂停超过普通请求间隔但小于声明 stream idle budget；heartbeat/proxy read timeout 策略使连接按设计存活，或以明确 terminal/reconnect 状态结束。
5. 让 proxy 对网络 chunk 任意拆分/合并；浏览器按换行增量解析，不能假设一 chunk 一 JSON。
6. 浏览器关闭/AbortController、调用 canonical cancel、刷新并 reconnect/query；核对 server Run/Step/Quota，而非只看 DOM。
7. 模拟 edge 502/504、实例 drain/滚动发布；新 Run 停止进入，已有 Run 完成/移交/恢复，UI 不永久 STREAMING。
8. 检查 response headers/config：stream path 不缓存、不 transform/整段 buffer，CORS 精确，Cookie/Authorization 不出现在 URL、edge access log、DOM/local storage 和 trace。

必须把实际 edge 配置片段、平台版本和浏览器 trace/时间线放入 `deployment-smoke.md`。直接 curl API 容器、Pod 内部 health、一次性读取完整 body 或只截图 UI 都是伪证据。

## 13. Backup/restore 演练

- 创建 demo tenant + Conversation + completed/failed/approval Runs。
- 生成备份并记录版本/时间。
- 在隔离数据库恢复。
- 运行 schema validation 与资源 counts。
- 查询一条完整 Run timeline。
- 验证 tenant scope 与 secret handling。
- 记录 RPO/RTO 实测值（只陈述这次演练，不夸大保证）。

## 14. Graceful shutdown 演练

### Case A：短 Run 可等待

- readiness 先变为 false。
- 不接受新 Run。
- 等待 active Run 在 grace window 完成。
- flush/terminal 状态完成后退出。

### Case B：长 Run 不能等待

- 持久化 handoff/cancel request。
- worker/新实例按 lease/recovery 策略接管或安全失败。
- quota reservation reconcile。
- client reconnect 查询明确状态。

### Case C：hard kill

- 启动后 sweeper 在目标窗口识别 stale state。
- 不重复不可安全重做的副作用。

## 15. Runbook 演练表

| Incident | Detection | Immediate action | Recovery proof | Follow-up |
| --- | --- | --- | --- | --- |
| Provider 429 spike | metric/error code | 限流/退避/降级 | success rate recovery | budget/config review |
| DB unavailable | readiness/errors | stop new Runs | reconnect + stale reconcile | pool/capacity |
| stale RUNNING spike | recovery metric | run sweeper/inspect lease | terminal count | crash root cause |
| quota mismatch | ledger invariant | freeze affected tenant | reconcile report | transaction fix |
| secret suspected | scan/alert | revoke/rotate | canary absent/new key works | incident review |
| bad migration | deploy check | stop rollout/forward fix | schema + smoke | rehearsal gap |

每项至少 table-top，一到两个做真实故障注入。

## 16. Demo 脚本

### 16.1 5-10 分钟产品 Demo

1. 说明用户问题与 tenant。
2. 发起技术 SEO audit。
3. 展示流式过程与 tool evidence。
4. 展示最终建议。
5. 打开 Run Timeline，解释 Run/Step/Tool/Observation。
6. 发起有副作用动作，演示 reject/approve 之一。
7. 展示刷新后状态仍在。

### 16.2 15-20 分钟工程 Demo

1. 架构图：Vue -> Nest -> Runtime -> Model/Tool -> PostgreSQL。
2. fake model test 演示 observation 进入第二轮。
3. abort/recovery failure injection。
4. cross-tenant denial。
5. trace 与 DB timeline 关联。
6. eval regression 报告。
7. 解释从 Codex 学到与未照搬的部分。

### 16.3 Failure Demo

选择可控场景：tool timeout、Approval reject、provider failure 或 hard restart。先写预期状态，现场不依赖随机故障。

## 17. 文档审计

### 17.1 内容

- 根 README 当前阶段、能力、命令、端口、链接准确。
- `docs/README.md`、roadmap、tasks、research/progress 一致。
- `.env.example` 与配置校验一致。
- 架构图与真实模块名一致。
- API/event/schema examples 从实际类型生成或手工验证。
- 不声明未实现能力。

### 17.2 链接与命令

- Markdown 相对链接全部存在。
- 源码路径存在。
- shell snippets 在 clean environment 运行。
- 不再把 `docs/development-task-plan.md` 当主看板。
- 旧阶段状态和截图清理/标注历史。

### 17.3 安全

- 无 API Key/token/个人环境路径（必要研究路径除外且明确是本地快照）。
- 日志示例已脱敏。
- screenshots 不含账号/secret。

## 18. Evidence bundle 结构建议

```text
capstone-evidence/
  manifest.md
  commands-and-results.md
  architecture.md
  test-summary.md
  eval-report.md
  security-report.md
  migration-rehearsal.md
  deployment-smoke.md
  browser-edge-stream-gate.md
  failure-drills.md
  remaining-risks.md
```

是否真的建目录由执行阶段决定；研究文档不宣称已存在。每条 evidence 记录 commit、环境、命令、日期和结果，避免只贴截图。

## 19. 最终验收清单

### 19.1 产品闭环

- [ ] 主 SEO audit 从输入到 final answer 完成。
- [ ] Observation 确实进入后续 sampling。
- [ ] Approval reject/approve 语义正确。
- [ ] stop/reconnect/recovery 正确。
- [ ] Run Timeline/evidence 安全且可理解。
- [ ] evidenceRefs existence/tenant/run/observation/hash/schema 完整性。

### 19.2 状态与可靠性

- [ ] Message/Run/Step/Tool/Approval 唯一终态不变量。
- [ ] idempotency replay。
- [ ] loop/time/token/tool budgets。
- [ ] stale recovery/crash points。
- [ ] quota settlement。

### 19.3 安全

- [ ] authentication/tenant-scoped queries。
- [ ] 真实 JWT/OIDC（或等价）adapter；`SINGLE_USER_DEMO` 未冒充 production。
- [ ] Tool authorization + Approval 不提权。
- [ ] cross-tenant suite。
- [ ] secret canary all sinks。
- [ ] input/output/rate limits。

### 19.4 质量

- [ ] unit/runtime/DB/contract/Web/E2E。
- [ ] deterministic eval/regression。
- [ ] typecheck/lint/build。
- [ ] flaky tests 无隐藏重试。

### 19.5 交付运行

- [ ] clean-room bootstrap。
- [ ] empty/upgrade migration rehearsal。
- [ ] deploy smoke/readiness/version。
- [ ] production-like HTTPS/TLS/trusted proxy/CORS gate。
- [ ] 浏览器经 edge 的 first-delta、proxy idle/chunk、disconnect/cancel/reconnect/drain gate。
- [ ] graceful shutdown/hard crash。
- [ ] backup/restore。
- [ ] incident runbook。

### 19.6 文档与表达

- [ ] root README 与所有入口更新。
- [ ] 架构/状态/安全图。
- [ ] Codex -> cloud mapping 总结。
- [ ] demo scripts。
- [ ] remaining risks/非目标。
- [ ] Markdown links/commands 验证。

## 20. Requirement-to-evidence 审计表

阶段结束前逐行填写，不允许用一个全量测试绿灯替代所有证明：

| Requirement | Authoritative evidence | Status | Contradiction/missing | Action |
| --- | --- | --- | --- | --- |
| Tool loop closed | fake runtime capture + E2E Run |  |  |  |
| All terminal states | DB invariant suite + recovery output |  |  |  |
| Tenant isolation | two-tenant negative integration |  |  |  |
| No secret leakage | canary sink scan |  |  |  |
| Real authentication | JWT/OIDC signature/claims/JWKS/rotation integration |  |  |  |
| Evidence integrity | cross-scope/dangling/hash mismatch negative suite |  |  |  |
| Clean startup | clean runner transcript |  |  |  |
| Migration safe | empty + upgrade rehearsal |  |  |  |
| Eval gate | versioned eval report |  |  |  |
| Deploy operable | smoke + shutdown + restore |  |  |  |
| Browser edge stream | HTTPS browser trace + first-delta/idle/chunk/reconnect/drain suite |  |  |  |
| Docs accurate | link/command audit |  |  |  |

状态只用：`Proven`、`Contradicted`、`Incomplete`、`Missing`。只有全部 required 为 Proven 才完成。

## 21. 复盘问题

### 产品

1. 用户为什么需要这个 Agent，而不是普通聊天？
2. 哪个 tool evidence 让最终建议更可信？
3. Approval 对用户的价值如何表达，而不只是增加弹窗？

### 架构

4. Controller、Application Service、Agent Runtime、Model Adapter、Tool Executor、Store 各自边界是什么？
5. UI Message、model history、RuntimeEvent、durable fact 为什么分开？
6. 哪些状态能从数据库恢复，哪些只是传输状态？
7. 为什么没有直接使用 LangGraph/workflow engine？

### Codex 学习

8. Codex Thread/Turn/Item/Event 映射到当前项目时做了哪些改写？
9. 为什么保留 REST/NDJSON/PostgreSQL，而不复制 app-server JSON-RPC/rollout？
10. 哪些安全原则来自 ToolOrchestrator，但没有复制 OS sandbox？
11. MCP/Multi-agent 最终进入还是未进入作品集？证据是什么？

### 可靠性与安全

12. tool side effect 成功但持久化失败时如何恢复？
13. 断线、取消、重启分别改变什么 canonical state？
14. 恶意 prompt 为什么不能访问其他 tenant？
15. 哪些字段绝不能进入模型、日志和 timeline？

### 运维

16. 如何知道部署健康、版本正确、migration 已完成？
17. stale Runs 增长时第一步看哪里？
18. backup 是否真正可恢复，证据是什么？
19. 当前 SLO 证明了什么，又没有证明什么？

### 成长

20. 这个项目最重要的三个架构不变量是什么？
21. 如果再做一个领域 Agent，哪些 core 边界可复用，哪些 SEO 模块应替换？
22. 下一阶段真正瓶颈来自数据、质量、成本、可靠性还是产品，而不是“再加什么热门功能”？

## 22. 完成陈述模板

```md
Phase 13 已完成。项目已在干净环境完成安装、迁移、构建、启动和 smoke；真实 auth adapter、主 SEO Tool loop、evidenceRefs 完整性、Approval、abort/reconnect/recovery、tenant isolation、quota 与 Run Timeline 均有自动化和运行证据；真实浏览器经 production-like HTTPS edge 通过 TLS/CORS/trusted-proxy、first-delta、proxy idle/chunk、disconnect/cancel/reconnect/drain gates；测试、eval、migration、deployment、shutdown、backup/restore 与文档审计通过。MCP/Multi-agent 的最终状态为 [included/optional/NO-GO]，依据为 [...]。

权威证据清单：...
当前部署/commit：...
明确非目标：...
剩余风险：...
下一阶段真实瓶颈：...
```

只有 requirement-to-evidence 表中所有 required 项为 `Proven`，才能使用这段陈述。
