# 学习路线进度与证据追踪

本文件只登记学习路线的证据，不替代 `docs/tasks/README.md` 的执行状态。

## 总进度

| Phase | 状态 | 核心证据 | 最近复盘 |
| --- | --- | --- | --- |
| 00 基线与测试基座 | Not Started | - | - |
| 01 结构化模型事件 | Not Started | - | - |
| 02 Tool Contract 与 Registry | Not Started | - | - |
| 03 单 Agent Tool Loop | Not Started | - | - |
| 04 工具可靠性与运行记录 | Not Started | - | - |
| 05 Human-in-the-loop | Not Started | - | - |
| 06 Context 工程 | Not Started | - | - |
| 07 Durable Execution | Not Started | - | - |
| 08 并发、流式重连与 Resume | Not Started | - | - |
| 09 可观测性、评测与测试 | Not Started | - | - |
| 10 云端安全与多租户 | Not Started | - | - |
| 11 MCP、Skills 与 Hooks | Not Started | - | - |
| 12 Multi-agent 实验 | Not Started | - | - |
| 13 生产化作品集收口 | Not Started | - | - |

状态只允许：`Not Started`、`Learning`、`Implementing`、`Verifying`、`Completed`。

## Phase 00 证据

- [ ] 测试框架已选定并有理由。
- [ ] 至少一个现有纯函数测试。
- [ ] AgentRuntime fake model 测试基座。
- [ ] 当前 happy/error/abort 状态机基线。
- [ ] 验证命令与输出记录。

## Phase 01 证据

- [ ] ModelStreamEvent 类型。
- [ ] provider chunk adapter tests。
- [ ] 现有文本 stream contract 未破坏。
- [ ] tool call arguments 跨 chunk 测试。
- [ ] `include_usage`、空 choices usage chunk、completed/usage 顺序与中断缺失语义。
- [ ] 成功事件流与 typed provider/abort error channel 的唯一所有权。

## Phase 02 证据

- [ ] ToolDefinition、raw call envelope、validated invocation、ToolResult 分层。
- [ ] timeout/approval/idempotency/version/attempt 等执行 metadata。
- [ ] 输入 schema runtime validation。
- [ ] duplicate registry test。
- [ ] unknown tool test。
- [ ] 一个只读 SEO tool。

## Phase 03 证据

- [ ] first sampling -> tool call。
- [ ] executor -> observation。
- [ ] observation -> second sampling。
- [ ] final answer -> completed。
- [ ] loop upper bound。
- [ ] mixed text + tool call 的 model-history 与 UI 可见策略有明确 contract。
- [ ] 同步 `/seo/chat` 的支持、禁用或统一 runtime 策略明确。

## Phase 04 证据

- [ ] tool step 持久化。
- [ ] orchestrator 主动 race executor / timeout / abort，并覆盖不响应 signal 的 executor。
- [ ] structured error taxonomy。
- [ ] oversized/sensitive output strategy。
- [ ] 完整阶段 5 收口证据。

## Phase 05 证据

- [ ] risk policy。
- [ ] approval request persistence。
- [ ] approve/reject/expire/cancel。
- [ ] decision idempotency。
- [ ] 前端 confirmation UX。
- [ ] 明确 Approval 在跨进程执行权与副作用 crash window 上仍由 Phase 07 收口。

## Phase 06 证据

- [ ] model history 独立类型。
- [ ] token budget policy。
- [ ] call/output normalization。
- [ ] 可从数据库重建的 ToolCall/Observation canonical item stream 与顺序。
- [ ] tool output truncation。
- [ ] compaction experiment。

## Phase 07 证据

- [ ] request idempotency。
- [ ] retry-safe tool contract。
- [ ] stale RUNNING recovery。
- [ ] checkpoint/resume boundary。
- [ ] crash simulation test。
- [ ] unknown side-effect outcome 的 manual-review durable 状态、释放规则与人工决议。

## Phase 08 证据

- [ ] active run concurrency policy。
- [ ] reconnect/query final state。
- [ ] persisted cancellation design。
- [ ] resume semantics。
- [ ] race tests。
- [ ] 若启用 replay，canonical transition + RunEvent outbox + sequence 同事务。

## Phase 09 证据

- [ ] trace correlation。
- [ ] latency/token/tool metrics。
- [ ] SEO eval dataset。
- [ ] runtime fixture、scorer fixture、live-model eval 三层分开。
- [ ] execution-attempt spans/links；长审批和整体 Run 时长由 durable timestamps 计算。
- [ ] regression command。
- [ ] failure dashboard or report。

## Phase 10 证据

- [ ] 真实 authentication adapter（或明确仍是 single-user demo），含 token/session 验证与 service actor replay protection。
- [ ] tenant-scoped queries。
- [ ] tool authorization。
- [ ] secret/output redaction。
- [ ] per-tenant quota/cost usage ledger；并发 reservation 满足可测硬上限。

## Phase 11 证据

- [ ] MCP adapter proof-of-concept。
- [ ] 受控 HTTPS/平台固定 stdio、SSRF/redirect/DNS/tenant cache 隔离等 external tool trust policy。
- [ ] skill instruction boundary。
- [ ] hook lifecycle experiment。
- [ ] hook rewrite 在 authorization/risk/approval 前完成，或使旧 approval 失效后全量重验。
- [ ] 保持 built-in tool path 可用。

## Phase 12 证据

- [ ] 单 Agent baseline。
- [ ] child run contract。
- [ ] parent-child persistence。
- [ ] durable READY/outbox dispatch，覆盖 commit 后 enqueue 前崩溃。
- [ ] concurrency/cost limits 与 paired statistical comparison。
- [ ] evidenceRefs 解析到同 tenant/task/attempt 的 canonical evidence。
- [ ] 实验证明比单 Agent 有价值。

## Phase 13 证据

- [ ] 一键运行与验证说明。
- [ ] 完整架构图。
- [ ] 可查看 Run/Step/Tool/Approval 证据。
- [ ] 关键失败演示。
- [ ] TLS/trusted proxy/CORS/auth storage/CSRF/stream proxy buffering 与真实部署入口 smoke。
- [ ] 技术复盘和取舍报告。

## 更新规则

- 勾选项后必须在同一阶段目录记录证据路径。
- 只有全部退出标准满足才标 Completed。
- 手动演示只能作为补充，不能替代自动化测试。
- 如果实现范围改变，先更新阶段 README，再更新任务文档。
