# Phase 13 源码阅读：Codex 如何把 Core Runtime 交付为产品

## 1. 阅读目标

Capstone 阶段不再按单一能力阅读，而是纵向回答：

1. 多个入口如何复用同一个 runtime？
2. 协议如何把内部生命周期变成稳定客户端事件？
3. 哪些事实被持久化用于 resume/audit，哪些高频事件不落盘？
4. SDK 如何提供易用 API 而不复制 Agent loop？
5. 生产级测试如何覆盖 thread/turn/tool/interrupt/recovery 的组合？
6. 当前项目距离“别人能运行、能证明、能运维”的交付还缺什么？

源码基于 `/Users/ayu/Desktop/codex@626147f728`。不要试图读完整仓库；沿四条交付链取证。

## 2. 路线 A：协议门面与 Runtime 分离

### 2.1 源码入口

| 顺序 | 文件 | 阅读重点 |
| --- | --- | --- |
| 1 | `codex-rs/app-server-protocol/src/protocol/common.rs` | initialize、thread/start、turn/start、request/response/notification 方法声明 |
| 2 | `codex-rs/app-server/src/message_processor.rs` | initialize gate、连接状态与请求 dispatch |
| 3 | `codex-rs/app-server/src/request_processors/initialize_processor.rs` | capability/connection 初始化 |
| 4 | `codex-rs/app-server/src/request_processors/thread_processor.rs` | Thread 资源门面 |
| 5 | `codex-rs/app-server/src/request_processors/turn_processor.rs` | Turn 请求映射与 submit |
| 6 | `codex-rs/app-server/src/bespoke_event_handling.rs` | core event 到 app-server notification 的映射 |

### 2.2 要跟踪的主链

```text
client initialize
  -> connection capability/session state
  -> thread/start
  -> ThreadManager / Codex::spawn
  -> turn/start
  -> Op::UserInput / submission queue
  -> RegularTask / run_turn
  -> core EventMsg/Items
  -> app-server notifications
  -> client
```

### 2.3 产品化学习点

- 未 initialize 的请求被统一拒绝，说明 protocol session state 与 Agent Thread state 不同。
- method declaration、serialization 和 request processor 分离，协议类型不是 runtime 内部类型。
- Thread CRUD/lifecycle 与 Turn execution 是不同资源。
- core events 经过映射才暴露，内部新增能力不必自动破坏所有客户端。
- request 返回并不等于 Turn 已完成；通知承载持续生命周期。

### 2.4 当前项目映射

当前使用 REST + NDJSON，无需复制 JSON-RPC/initialize。但 Capstone 要检查：

- `packages/contracts` 是否是稳定 transport contract？
- `AgentRuntimeEvent -> ChatStreamEvent` mapper 是否仍是唯一映射边界？
- Conversation CRUD、Run query/cancel/Approval decision 是否是资源 API，而不是混在 chat stream？
- 连接断开与 Run canonical state 是否分开？
- 若未来 cron/webhook/SDK 接入，是否复用同一个 application runtime？

## 3. 路线 B：Thread/Turn 核心与持久化事实

### 3.1 生命周期入口

- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/session/handlers.rs`
- `codex-rs/core/src/tasks/regular.rs`
- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/context_manager/history.rs`

这部分不再逐行重读所有 sampling/tool 细节，而是画出 runtime owner、task/turn boundary、cancellation、context 与 terminal event 的关系。

### 3.2 Persistence 入口

- `codex-rs/rollout/src/policy.rs`
- `codex-rs/rollout/src/recorder.rs`
- `codex-rs/thread-store/src/store.rs`
- `codex-rs/thread-store/src/` 的实现与 tests。

### 3.3 `rollout::policy` 要观察什么

`is_persisted_rollout_item`/`should_persist_response_item`/`should_persist_event_msg` 显式筛选 durable items。重点不是 JSONL 格式，而是：

- 不是所有 UI/stream event 都是恢复事实。
- Tool call/output、final message、turn terminal 等需要保留。
- begin/delta 等高频 transient event 通常不需要全部落盘。
- persistence policy 是可测试的独立边界。

当前 PostgreSQL 项目应形成自己的 canonical fact table/policy，而不是增加 rollout JSONL 双写。

### 3.4 `ThreadStore` 要观察什么

本地 trait 明确 create/resume/append/persist/flush/load/read/list/delete 等职责；`load_history` 服务于 resume/fork/rollback/memory。学习点：

- store 是 storage-neutral boundary。
- append 与 flush/persist 有不同 durability 时机。
- live loaded session 与 persisted thread 可分离。
- 读取 summary 与加载完整 history 不必相同。

当前项目可继续使用 Prisma/PostgreSQL，不必为“像 Codex”加 store trait；但当 Runtime 中散落查询、测试无法注入 store、或 worker/recovery 需要统一事务时，再建立明确 repository/store。

### 3.5 当前项目反向检查

- `AgentRunRecorderService.completeRun` 当前会在发现 unfinished steps 后只 logger warning；最终阶段应由测试和事务保证不变量，而非接受 warning。
- `AgentRuntimeService` 当前直接做 Message/Conversation/Prisma 操作；前序阶段若已重构，确认 application/runtime/store 职责。
- delta 不应逐 token 落库；final content/step/result/usage 才是事实。
- Run/Step/Approval/Quota/recovery 的 terminal transition 必须能从 DB 重建。

## 4. 路线 C：TypeScript SDK 如何复用 Runtime

### 4.1 源码入口

- `sdk/typescript/src/codex.ts`
- `sdk/typescript/src/thread.ts`
- `sdk/typescript/src/events.ts`
- `sdk/typescript/src/items.ts`
- `sdk/typescript/src/exec.ts`
- `sdk/typescript/tests/run.test.ts`
- `sdk/typescript/tests/runStreamed.test.ts`
- `sdk/typescript/tests/abort.test.ts`

### 4.2 阅读问题

- `Codex.startThread` 与 `resumeThread` 只保存哪些 client-side identity/options？
- `Thread.runStreamed` 如何把 underlying JSONL/process stream 映射成 async iterable events？
- `run()` 是否通过消费 streamed events 实现，而不是第二套 runtime？
- thread id 何时获得和复用？
- AbortSignal 如何影响开始前和迭代中的执行？
- structured output schema 如何通过 turn options 传递？
- items/events 如何保持 union 类型？

### 4.3 当前项目学习点

Capstone 不一定需要发布 npm SDK，但至少要让 Web API client：

- 只封装 protocol/transport 和易用 reducer。
- 不在浏览器复制 run state machine。
- 支持 start/query/cancel/approval/stream/reconnect 的一致 ID。
- AbortSignal 中断传输，但 canonical cancel 使用明确 server API/语义。

未来若增加 SDK，应复用 contracts 与 server runtime，不能在 SDK 里直接调用模型。

## 5. 路线 D：测试密度如何保护产品

### 5.1 App-server v2 tests

按行为采样阅读：

| 主题 | 文件 |
| --- | --- |
| 初始化/验证 | `initialize.rs`、`request_validation.rs` |
| Thread 资源 | `thread_start.rs`、`thread_read.rs`、`thread_list.rs`、`thread_delete.rs`、`thread_archive.rs` |
| Resume/Fork/Rollback | `thread_resume.rs`、`thread_fork.rs`、`thread_rollback.rs` |
| Turn | `turn_start.rs`、`turn_interrupt.rs`、`turn_steer.rs` |
| Context | `compaction.rs` |
| Tool | `dynamic_tools.rs`、`mcp_tool.rs`、`command_exec.rs` |
| Approval/Permission | `request_permissions.rs`、`safety_check_downgrade.rs` |
| Extensions | `skills_list.rs`、`plugin_list.rs`、`hooks_list.rs` |
| Output/limits | `output_schema.rs`、`rate_limits.rs` |

不要追求文件数量。每类挑 1-2 个，记录 fixture、mock boundary、event assertions、failure path 和最终状态。

### 5.2 Core tests

- `codex-rs/core/src/session/turn_tests.rs`
- `codex-rs/core/src/tools/router_tests.rs`
- `codex-rs/core/src/tools/registry_tests.rs`
- `codex-rs/core/src/context_manager/history_tests.rs`
- `codex-rs/core/src/stream_events_utils_tests.rs`
- `codex-rs/core/src/agent/control_tests.rs`
- `codex-rs/core/tests/suite/` 中 hooks/MCP/skills/plugins 等。

观察“纯单元 + runtime mock integration + app-server protocol integration”的层次。当前项目也应把 pure contract、fake runtime、DB、HTTP/NDJSON、Web E2E 分开。

### 5.3 SDK tests

`runStreamed.test.ts` 覆盖重复 turn、resume、structured output；`abort.test.ts` 覆盖开始前和迭代中 abort。学习点：client API 的流式消费和取消也必须有专门 contract tests，不能只测后端。

## 6. 路线 E：Telemetry 与可复盘输出

建议从以下入口按需追踪：

- `codex-rs/otel/`。
- `codex-rs/core/src/turn_timing.rs`。
- `codex-rs/core/src/mcp_tool_call/telemetry.rs`。
- `codex-rs/app-server/tests/suite/v2/analytics.rs`。
- `codex-rs/rollout-trace/`。

回答：

- 哪些 ID 关联 thread/turn/item/tool？
- timing 在哪个边界开始/结束？
- telemetry 记录 source/status/duration 而不记录哪些 payload？
- analytics 与 canonical persistence 有何区别？
- trace 工具如何从 rollout 构建可分析视图？

当前项目的 Run Timeline 不应直接等同于 OTEL trace。用户时间线来自安全业务投影，运维 trace 用于诊断；二者通过 IDs 关联。

## 7. 路线 F：入口复用与产品 packaging

选择性查看：

- `codex-rs/cli/src/`、`codex-rs/tui/src/` 的入口如何调用 core。
- `codex-rs/exec/src/` 的非交互执行与 JSONL 输出。
- `codex-rs/app-server/src/` 的服务入口。
- `sdk/typescript` 如何包装 exec/protocol。

只回答一件事：入口负责 transport、参数、呈现与生命周期连接，Agent loop 仍在 core。映射到当前项目：Vue、REST、cron、webhook、未来 SDK 都不拥有另一套 loop。

## 8. 当前项目全链反向阅读

按用户故事而不是目录逐个核对：

### 8.1 发起 Run

```text
apps/web/src/hooks/useSeoWorkspace.ts
  -> apps/web/src/api/seo.ts
  -> packages/contracts/src/seo.ts
  -> apps/api/src/seo/seo.controller.ts
  -> apps/api/src/seo/seo.service.ts
  -> apps/api/src/agent-runtime/agent-runtime.service.ts
```

检查 request/actor/idempotency/stream/cancel/context/tool/terminal state。

### 8.2 持久化与恢复

```text
prisma/schema.prisma
agent-run-recorder.service.ts
Conversation/Message services
Phase 07/08 repositories, recovery jobs, run query endpoints
```

检查每个 crash point 的 canonical state。

### 8.3 前端恢复

```text
apps/web/src/api/seo.ts
apps/web/src/hooks/useSeoWorkspace.ts
apps/web/src/utils/conversation-turns.ts
Approval/Timeline components from later phases
```

检查 unknown event、EOF、refresh、reconnect、duplicate event、server terminal reconciliation。

### 8.4 配置与启动

```text
README.md
.env.example
package.json / app package.json
docker-compose.yml
prisma.config.ts / migrations
deployment/CI files introduced later
```

在一个干净临时目录实际按文档运行，不使用已有 node_modules、数据库或 shell history 作为隐性依赖。

### 8.5 浏览器、HTTPS edge 与流式代理

Codex app-server/SDK 的本地 process/JSONL 测试不能替云端项目证明 Internet edge。沿当前部署配置额外反向阅读：DNS/TLS termination、reverse proxy/ingress、trusted proxy、CORS/auth cookie 或 Authorization、NDJSON response headers、buffer/cache/transform、read/idle timeout、heartbeat、drain 与 client disconnect。

必须画出真实路径：

```text
Browser
  -> public HTTPS DNS/certificate
  -> reverse proxy / ingress / load balancer
  -> NestJS stream endpoint
  -> Agent Runtime + DB canonical Run
```

并回答：浏览器何时收到 first delta；代理是否整段 buffering；chunk 被任意拆分/合并时 parser 是否仍正确；idle timeout/502/滚动发布后 canonical Run 如何查询；哪些 forwarded headers 可被信任；token 是否会进入 URL/access log/local storage。最终 gate 必须从真实浏览器通过 edge 执行，不能用 API 容器直连或 `curl -k` 替代。

## 9. 推荐阅读节奏

### Session 1：从客户端协议到 core

1. `protocol/common.rs` 的 initialize/thread/turn declarations。
2. message processor 初始化 gate。
3. thread/turn processors。
4. 当前 REST/NDJSON mapper 对照。

### Session 2：从 core 到 durable fact

1. `run_turn` 只复盘主结构。
2. rollout policy。
3. ThreadStore trait。
4. 当前 PostgreSQL canonical fact matrix。

### Session 3：SDK 和测试

1. TS `codex.ts/thread.ts/events.ts`。
2. runStreamed/abort tests。
3. 选 6-10 个 app-server/core tests。
4. 设计当前项目测试金字塔与命令。

### Session 4：交付与运维

1. exec/app-server/CLI 入口复用。
2. telemetry/timing/trace。
3. 当前 README/scripts/deploy/runbook audit。
4. 浏览器 -> HTTPS edge -> proxy -> NDJSON -> canonical Run gate。
5. Capstone evidence map。

## 10. 第一遍可跳过

- app-server 所有方法和实验 feature。
- 每个 TUI cell/组件。
- rollout compression 的底层编码优化。
- SQLite/thread-store 索引细节。
- SDK Python 与 TypeScript 的重复路径；选 TypeScript 深读即可。
- Bazel 构建细节。
- Codex marketplace/remote control 等非 Capstone 主线。

不能跳过协议映射、canonical persistence policy、resume/abort tests、多入口共享 runtime，以及浏览器经 HTTPS edge 的 stream buffering/idle/chunk/cancel/reconnect 证据。

## 11. 源码阅读产物

- 一张 Codex client -> app-server -> core -> store -> event 的纵向图。
- 一张当前项目 Vue -> Nest -> Runtime -> Model/Tool -> Prisma -> Vue 图。
- Codex rollout policy 与当前 canonical fact 对照表。
- TS SDK 的 stream/abort/resume contract 摘要。
- 至少 12 个 Codex tests 映射到当前测试矩阵。
- 当前 README/scripts/build/deploy/docs 的事实审计。
- 浏览器 HTTPS/TLS/trusted-proxy/CORS 与 NDJSON first-delta/idle/chunk/reconnect gate 证据图。
- 一份“不复制 Codex JSON-RPC/rollout/TUI，但吸收哪些交付原则”的报告。

## 12. Teach-back 问题

1. 为什么 app-server 协议对象不应直接成为 core runtime 对象？
2. Thread/Turn 与当前 Conversation/AgentRun 的差异是什么？
3. 哪些事件必须持久化，哪些只属于流式传输？
4. ThreadStore 的 resume/load 与 loaded Session 有何区别？
5. TS SDK 为什么不拥有 Agent loop？
6. `run()` 与 `runStreamed()` 如何避免两套行为？
7. 为什么 backend tests 与 SDK/Web stream tests 都需要？
8. Run Timeline 与 OTEL trace 为什么不是同一份数据？
9. 当前根 README 有哪些已知漂移，如何用 clean-room test 发现？
10. 为什么 app-server/SDK 本地流测试不能证明浏览器经过 production proxy 后仍增量到达？
11. 最终架构报告中哪些 Codex 能力应明确写为“不照搬”？
