# 架构清单与学习阶段追踪矩阵

## 1. 为什么需要这张矩阵

[`architecture-learning-checklist.md`](../codex/architecture-learning-checklist.md) 按架构能力组织，阶段目录则按学习顺序组织。两种视角解决的问题不同：

- 架构清单回答“一个可靠 Agent Runtime 需要掌握什么”。
- 学习阶段回答“当前项目应该先学什么、后学什么”。
- 本矩阵回答“每项能力在哪个阶段首次建立、在哪个阶段强化、用什么证据闭环”。

矩阵中的“负责阶段”不等于该阶段必须一次做完所有生产级细节。每项能力按三种责任划分：

| 责任 | 含义 |
| --- | --- |
| 建立 | 首次定义稳定概念、类型或最小行为，并有自动化测试 |
| 强化 | 增加失败路径、持久化、权限、并发或恢复等真实约束 |
| 收口 | 用跨模块测试、运行证据和架构说明证明能力可交付 |

## 2. 阶段到清单条目的总映射

| 阶段 | 主要建立 | 后续强化或收口 | 关键证据 |
| --- | --- | --- | --- |
| Phase 00 基线与测试 | K1、K2；B2/B4/G1 的现状基线 | K3 的最小基础 | fake model、现有 happy/error/abort 状态机测试 |
| Phase 01 模型事件 | A2、C1；I1 的 provider/stream 边界 | K1、K3 | provider chunk adapter、成功事件与 typed error channel、外部 NDJSON 回归 |
| Phase 02 Tool Contract | D1-D5 的最小 contract、L1、H1 元数据基础 | K1 | raw call envelope、schema、registry、router、unknown/duplicate tool 测试 |
| Phase 03 Tool Loop | C2、D6、E1/E4 的 call-output 基础 | K2、A2 | 两轮 sampling 集成测试、Observation 回填断言 |
| Phase 04 工具可靠性 | B2、B4、D4、F1、G1；C3/J1 的关联 metadata 基础 | I1、K2/K3 | tool step、orchestrator timeout race、预算、安全摘要、终态矩阵 |
| Phase 05 HITL | H1、H2 | H3、I3、K3/K4 | approval 持久化与 approve/reject/expire/cancel 测试 |
| Phase 06 Context | E1-E5 | D6、F1、K1/K2 | token 预算、normalization、截断、compaction 实验 |
| Phase 07 Durable Execution | F1-F4、F2/F3、I2/I3 | B2、B4、C4、K4 | 幂等重放、stale run、crash simulation、checkpoint |
| Phase 08 并发与 Resume | G1-G4 | F3、C4、K4 | race test、reconnect、持久化取消、resume 语义 |
| Phase 09 可观测性与评测 | J1-J3、K1-K4 | C4、I1-I3、O | trace、metrics、eval set、回归门禁、失败报告 |
| Phase 10 云端安全 | B1、H3/H4、N1-N4 | G2/G3、F4、I3 | tenant-scope 测试、工具鉴权、配额、脱敏 |
| Phase 11 扩展架构 | A3、L2/L3 | D1-D6、H1-H4 | MCP adapter、skill/hook 边界、信任策略 |
| Phase 12 Multi-agent | M | G2/G3、F2/F3、J2/J3 | child run contract、父子持久化、成本与基准对比；不把工具并行混入实验 |
| Phase 13 生产化收口 | O、N4 | 全部核心 P0/P1/P2 项 | 一键验证、完整 Run 证据、失败演示、取舍报告 |

## 3. 按架构域追踪

### A. 系统边界与协议

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| A1 多入口共享 Core Runtime | Phase 07 | Phase 13 | API 与恢复/后台入口都经过同一 runtime 和 recorder，不复制 Agent loop |
| A2 稳定协议与内部类型分离 | Phase 01 | Phase 03、04、09 | provider event、runtime event、NDJSON event 分层，内部工具事件不意外破坏前端 |
| A3 Capability negotiation | Phase 11 | Phase 13 | 只有出现真实外部扩展或第二类客户端时才引入版本/capability，不做空协议 |

### B. 生命周期模型

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| B1 Thread / Conversation | Phase 10 | Phase 13 | Conversation 有 owner/tenant scope，资源状态和级联关系明确 |
| B2 Turn / AgentRun | Phase 00 | Phase 04、07 | Run 的创建与终态可测，重复请求与崩溃不会留下不可解释状态 |
| B3 Task / Runner | Phase 07 | Phase 08 | 只有在请求生命周期与 durable execution 分离时才抽出 runner/worker 边界 |
| B4 Item / AgentStep | Phase 00 | Phase 04、05、07 | Step 记录可观察事实，不记录思维链；tool/approval/retry 的状态有明确表达 |

### C. Agent loop 与模型适配

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| C1 结构化 ModelStreamEvent | Phase 01 | Phase 09 | 文本、tool call、usage、finish 进入成功事件流；provider failure/abort 使用一种写清且不重复处理的 typed error channel（或显式 variant） |
| C2 采样循环 | Phase 03 | Phase 04、09 | ToolCall 后执行并回填 Observation，下一轮 sampling 得到最终回答；预算阻止无限循环 |
| C3 Step Context 快照 | Phase 04 | Phase 09 | Phase 04 先记录 samplingIndex/model/toolCount/finish/usage；Phase 09 再补 prompt/context/tool/policy version 与 trace 关联 |
| C4 Provider session 与重试 | Phase 07 | Phase 08、09 | provider 重试与业务 Run 重试分开，流式断线不会重复副作用 |

### D. Tool Calling

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| D1 ToolDefinition | Phase 02 | Phase 05、11 | 模型可见 schema 与执行 metadata 稳定；外部工具不能覆盖系统风险策略 |
| D2 ToolCall | Phase 02 | Phase 03、07 | raw call envelope 保留 callId/name/argumentsJson/sampling attempt；validated invocation 另带 typed input，身份/租户不由模型决定 |
| D3 ToolRegistry | Phase 02 | Phase 11 | 重复名称、未知工具、启停与 executor 解析都可测试 |
| D4 ToolExecutor | Phase 02 | Phase 04、05、10 | Phase 02 只证明解析/校验/确定 dispatch；Phase 04 补 timeout/abort/错误/脱敏，Phase 10 才完成真实鉴权 |
| D5 ToolRouter | Phase 02 | Phase 03、11 | provider output 只在 router/adapter 变成内部 ToolCall，不在业务 service 写 provider switch |
| D6 Observation | Phase 03 | Phase 04、06 | model view 与 audit view 可不同；call/output 配对、大小/脱敏、来源和“外部数据不是高优先指令”可证明 |
| D7 工具并行 | 条件性后期实验 | Phase 13 | 它与 Multi-agent 是两种能力；只有单工具可靠且有真实性能瓶颈时单独验证有界并行、结果顺序、取消和共享状态 |

### E. Context 工程

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| E1 数据分层 | Phase 03 | Phase 06 | UI transcript、model history、runtime event、persistent fact 不再混用 |
| E2 ContextBuilder | Phase 06 | Phase 09 | 通用预算/规范化与 SEO domain contributor 分开，构造结果可测试和解释 |
| E3 Token 预算 | Phase 06 | Phase 09、10 | system/history/tool/current/completion 有预算，实际 usage 可归因到 Run/tenant |
| E4 历史规范化 | Phase 03 | Phase 06 | tool call/output 配对、孤立 output、重复当前消息等不变量有测试 |
| E5 Compaction | Phase 06 | Phase 07、09 | 触发条件、summary 来源和失败行为明确，原始事实不被不可逆覆盖 |

### F. 持久化与恢复

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| F1 Canonical facts | Phase 04 | Phase 06、07 | Phase 04 建审计摘要；Phase 06 持久化可重建的 call/observation item stream；Phase 07 再证明恢复，delta 不逐 token 落库 |
| F2 幂等 | Phase 07 | Phase 10、12 | 请求、写工具和 child task 各自有幂等语义，重放不重复副作用 |
| F3 Crash recovery | Phase 07 | Phase 08、12 | stale RUNNING 可识别；可恢复与不可恢复步骤均有确定收口 |
| F4 Store boundary | Phase 07 | Phase 10 | 写入事务、查询投影和 tenant scope 有清晰边界，不散落 Prisma 调用 |

### G. 中断、并发与背压

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| G1 Cancellation | Phase 00 | Phase 04、08 | signal 贯穿 provider/tool；Message/Run/Step 终态一致；取消不是普通错误 |
| G2 Conversation 并发 | Phase 08 | Phase 10、12 | 同会话 active Run 规则在多实例下仍成立，重复点击和竞态有测试 |
| G3 Queue 与背压 | Phase 08 | Phase 10、12 | 先有状态/幂等/取消，再按真实负载引入队列；租户并发和 Retry-After 明确 |
| G4 Steer / Resume / Fork | Phase 08 | Phase 12 | 四种语义分开；先证明 resume，再把 steer/fork 当可选能力 |

### H. Human-in-the-loop 与安全

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| H1 Risk metadata | Phase 02 | Phase 05、11 | 风险由系统定义，参数解析后可提升风险，模型不可降级 |
| H2 Approval | Phase 05 | Phase 07、10 | 请求、决策、过期和取消可持久化、幂等、可恢复且绑定具体 ToolCall |
| H3 Authentication / Authorization | Phase 10 | Phase 13 | 所有资源和工具重新做 server-side scope，不信任前端或模型给出的身份 |
| H4 Isolation | Phase 10 | Phase 11、13 | secret、网络、响应大小、日志和租户凭证隔离；tool/网页输出按不可信数据处理，不得提升 instruction/permission；不提前复制 OS sandbox |

### I. 错误、重试与韧性

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| I1 Error taxonomy | Phase 01 | Phase 04、05、07、09 | Phase 01 只建立 provider/stream/abort 边界；后续依次补 tool/permission/timeout/persistence，并在 Phase 09 统一关联和报表 |
| I2 Retry policy | Phase 07 | Phase 09、10 | 只重试可重试错误，有上限、退避、预算和副作用安全性 |
| I3 Partial failure | Phase 05 | Phase 07、08 | 工具成功但持久化/回填失败、stream 断开等场景不会盲目重复动作 |

### J. 可观测性与评测

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| J1 Trace model | Phase 04 | Phase 09 | Phase 04 先关联 run/step/call/sampling；Phase 09 再接 request、execution attempt、recovery link，且日志不泄漏 payload/secret |
| J2 Metrics | Phase 09 | Phase 10、12 | 低基数指标描述趋势；Run/tenant 成本归因进入 usage ledger 或受控查询，不把 tenantId 当普通 metric label |
| J3 Evaluation | Phase 09 | Phase 12、13 | 固定 SEO 数据集分别评估答案、工具选择、参数、拒绝和成本 |

### K. 测试架构

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| K1 Unit tests | Phase 00 | 所有阶段 | 纯类型转换、schema、registry、router、context、policy 可快速测试 |
| K2 Runtime integration tests | Phase 00 | Phase 03-08 | fake model/tool/store 驱动状态机正常、失败、取消、重试和恢复路径 |
| K3 Contract tests | Phase 01 | Phase 04、05、08 | NDJSON/API/approval/reconnect 的外部兼容性有固定断言 |
| K4 Recovery tests | Phase 07 | Phase 08、10、12 | 重启、幂等重放、并发、审批和 child run 的恢复有故障注入测试 |

### L. 扩展架构

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| L1 Built-in tools | Phase 02 | Phase 03、04 | 至少一个真实只读 SEO 工具经过统一 contract 和完整 Agent loop |
| L2 MCP | Phase 11 | Phase 13 | MCP 只适配发现/调用，不绕过本地 schema、权限、timeout 和审计 |
| L3 Skills / Plugins / Hooks | Phase 11 | Phase 13 | 指令、工具、hook、分发包概念分开，失败与版本策略明确 |

### M. Multi-agent

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| M Multi-agent | Phase 12 | Phase 13 | child run 独立、上下文最小、结果结构化、权限收窄、预算有界，并优于单 Agent 基线 |

### N. 云端生产化

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| N1 多租户 | Phase 10 | Phase 13 | schema、查询、工具、成本、导出/删除都按 tenant scope |
| N2 Worker 与执行位置 | Phase 07 | Phase 08、10 | 只有长任务和多实例约束成立时迁移 worker，并能从 canonical state 重建 |
| N3 Rate limit 与成本 | Phase 10 | Phase 12、13 | 用户/租户/provider 限额分层，运行中预算和恢复时间明确 |
| N4 Deployment safety | Phase 10 | Phase 13 | migration、graceful shutdown、readiness、secret、backup 有可演练方案 |

### O. 作品集与表达

| 条目 | 建立阶段 | 强化/收口阶段 | 阶段内应证明什么 |
| --- | --- | --- | --- |
| O 作品集 | Phase 09 | Phase 13 | 不只展示聊天 UI，而是展示完整 Run、失败路径、测试、取舍和云端边界 |

## 4. 如何用矩阵更新进度

每完成一个阶段，按下面顺序追踪：

1. 在阶段 `practice-and-acceptance.md` 保存测试和运行证据。
2. 在 [`progress-tracker.md`](./progress-tracker.md) 勾选该阶段证据。
3. 回到架构清单，只勾选本阶段已经由证据证明的条目。
4. 本矩阵中属于“强化”的条目不得因为建立了基础类型就提前宣称完成。
5. 如果某项能力被移到其他阶段，同时更新矩阵、阶段 README 和总路线，避免三个入口互相矛盾。

## 5. 完整性检查

路线收口时至少回答：

- P0 条目是否全部有自动化测试，而不是只有 Markdown？
- P1 条目是否覆盖正常、失败、取消和边界输入？
- P2 条目是否经过云端身份、多实例和恢复语义审查？
- P3 条目是否由真实扩展需求触发，而不是因为 Codex 有同名能力？
- 每个 Completed 阶段能否从 tracker 一路追到测试、运行日志和代码入口？

如果答案无法从证据路径得到，就保持未完成状态。
