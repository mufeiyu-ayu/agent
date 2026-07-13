# Feedback、诊断与隐私边界

本页单独研究 Codex 的反馈上传链路。它不只是一个“发日志”的辅助功能，而是把 TUI、App Server、线程树、rollout、SQLite 日志、环境诊断、子进程和 Sentry 上传串成了一条高权限数据出口。把它从总报告中拆出来，是为了完整保留其中值得学习的工程写法、真实隐私边界和测试缺口。

研究快照：`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`。

## 1. 架构问题

一次反馈提交必须同时回答四个问题：

1. 用户同意上传哪些数据？
2. 哪个模块有权选择本地附件？
3. 日志、rollout 与诊断分别属于哪个 Thread / account？
4. 网络返回成功时，系统究竟能证明什么？

Codex 已经把 UI 同意、数据收集和 Sentry 传输拆成不同层，但这些层的契约还没有形成同一个强不变量。

```mermaid
sequenceDiagram
    participant User as 用户
    participant TUI as Feedback UI
    participant AS as App Server
    participant TM as ThreadManager / State DB
    participant FB as CodexFeedback
    participant Doctor as codex doctor --json
    participant Sentry as Sentry transport

    User->>TUI: 选择分类
    TUI->>TUI: 展示预计附件并选择是否上传日志
    User->>TUI: note + includeLogs
    TUI->>AS: feedback/upload
    AS->>FB: snapshot(threadId)
    AS->>TM: 查询 root + 最近 descendants
    AS->>Doctor: 生成 JSON 诊断
    AS->>FB: upload_feedback(options)
    FB->>FB: 读取全部 path-backed attachments
    FB->>Sentry: event + attachments
    Sentry-->>FB: transport flush
    FB-->>AS: Ok(())
    AS-->>TUI: threadId
    TUI-->>User: Feedback uploaded
```

最重要的不变量应是：**同意清单、实际附件清单、数据所有者和上传回执必须属于同一个不可变 operation**。当前实现只在 TUI happy path 上近似满足这一点。

## 2. 源码事实：真实调用链

### 2.1 TUI 同意流

- `tui/src/bottom_pane/feedback_view.rs`
  - `feedback_selection_params` 选择 `bug`、`bad_result`、`good_result`、`safety_check` 或 `other`。
  - `feedback_upload_consent_params` 显示预计上传的 `codex-logs.log`、doctor report、Windows sandbox log、当前 rollout 与 auto-review rollout。
  - “Yes” 产生 `OpenFeedbackNote { include_logs: true }`；“No” 仍可提交反馈，但 `include_logs: false`。
  - `FeedbackNoteView::submit` 会 trim note，空字符串转为 `None`。
- `tui/src/chatwidget.rs::open_feedback_consent`
  - 从当前 widget 取得 rollout path、Thread ID 和环境诊断，用于构造同意页。
- `tui/src/app/background_requests.rs`
  - `build_feedback_upload_params` 只在 `include_logs=true` 时把当前 rollout 放入 `extra_log_files`。
  - `submit_feedback` 在后台发送 RPC，并把完成事件绑定到提交时捕获的 `origin_thread_id`。
  - `enqueue_thread_feedback_event` 将迟到结果放回原 Thread 的有界事件缓冲，而不是直接污染当前可见 Thread。

这里有两个很值得学习的产品状态设计：

1. “提交反馈”和“上传诊断”是两个独立选择；拒绝日志不会阻止纯文本反馈。
2. 后台结果携带 origin Thread，并复用 thread-scoped buffer，避免切换 Thread 后把结果显示到错误会话。

### 2.2 App Server 收集流

入口是 `app-server/src/request_processors/feedback_processor.rs::upload_feedback_response`：

```text
feedback/upload
  -> 检查 config.feedback_enabled
  -> parse optional thread_id
  -> snapshot process-global feedback ring + tags + env diagnostics
  -> includeLogs ? 查询 root/descendant Thread : 跳过
  -> flush log DB 并查询 SQLite feedback logs
  -> 解析 rollout / Guardian / Windows sandbox paths
  -> 无条件追加 client extraLogFiles
  -> includeLogs ? 运行 codex doctor --json : 跳过
  -> spawn_blocking(snapshot.upload_feedback)
  -> FeedbackUploadResponse { thread_id }
```

线程树最多保留 8 个 Thread：root 固定保留，其余按 UUIDv7 字符串排序，只取最近 7 个 descendant。这个上限控制的是 Thread 数量，不是文件数、附件字节或内存占用。

### 2.3 进程级日志快照

`feedback/src/lib.rs::CodexFeedback` 拥有两个进程级共享状态：

- 4 MiB `RingBuffer`：`logger_layer` 不受调用者 `RUST_LOG` 限制，默认捕获 TRACE；只显式排除 `codex_api::responses_websocket_timing`。
- 最多 64 个 `feedback_tags`：同名 key 后写覆盖，snapshot 时整体 clone。

`snapshot(thread_id)` 只是把 Thread ID 写进快照元数据，并不会按 Thread 过滤 ring 或 tags。因此上传 Thread A 的反馈时，最后 4 MiB 中可能同时存在 Thread B、后台刷新、其他 account 或其他 App Server client 的日志。

Ring 以字节为单位从头淘汰，能限制常驻内存，但可能从 UTF-8 字符或日志行中间截断。它适合作为 loss-bounded diagnostics buffer，不应被解释为完整、Thread-scoped transcript。

### 2.4 附件与上传

`FeedbackSnapshot::feedback_attachments` 按以下顺序组装附件：

1. `include_logs=true` 时加入 ring 或 SQLite override，文件名为 `codex-logs.log`；
2. 加入内存型 doctor report；
3. `include_logs=true` 时加入 connectivity diagnostics；
4. 对每个 `FeedbackAttachmentPath` 执行同步 `fs::read`，失败则 warning 后跳过。

`FeedbackSnapshot::upload_feedback` 构造 Sentry envelope，调用 `send_envelope` 后最多 `flush(10s)`，最后无条件返回 `Ok(())`。返回值没有 event ID、附件 manifest、服务端 receipt，也没有区分“已排队”“flush 超时”“服务端已持久化”。

## 3. 值得学习的代码

### 3.1 失败隔离：诊断不能阻塞主反馈

`feedback_doctor_report.rs::doctor_feedback_report` 把 doctor 当作 best-effort 附件：

- 使用当前 Codex executable，而不是在 App Server 内复制 doctor 逻辑；
- `kill_on_drop(true)` 配合 25 秒 timeout，避免遗留子进程；
- spawn、timeout、非 JSON 与 parse error 都只跳过附件；
- doctor tag 使用低基数字段，并把 tag 值截断到 256 字符。

这段设计体现了很好的**主结果与增强证据分离**：反馈文本是主操作，诊断报告是可失败 enrich step。迁移到 NestJS 时，对可观测性 enrich、浏览器截图或第三方 metadata 也应采用相同边界。

### 3.2 保留业务保留字段

`FeedbackSnapshot::upload_tags` 明确保留 `thread_id`、`classification`、`cli_version`、`session_source` 和 `reason`，client tags 与 process tags 都不能覆盖它们。client tags 的优先级又高于 process-global tags。

这比简单 `Object.assign` 更可靠：协议拥有者先写 canonical identity，扩展方只能补非保留字段。相同规则适用于 Agent Run telemetry、tool metadata 和 audit context。

### 3.3 迟到 UI 结果回到原 owner

`submit_feedback` 在请求前捕获 `origin_thread_id`，完成事件再由 `handle_feedback_submitted` 路由到该 Thread 的 buffer。它把“当前屏幕是谁”与“操作属于谁”分开，是桌面多会话应用处理异步副作用的正确方向。

不过这里绑定的仍只是 Thread；真正跨 account 的操作还应携带 account generation 和 operation ID。

### 3.4 附件读取失败逐项降级

路径附件逐个读取、逐个跳过，避免一个已删除 rollout 让整份反馈失败。该模式适合“证据集合”，但不适合“用户明确同意的精确 manifest”：若 UI 告知会发送四个文件，最后只发送两个，回执应明确报告缺失，而不是静默把整体称为 uploaded。

## 4. 隐私与权限边界

### 4.1 `extraLogFiles` 是独立的本地文件读取能力

`FeedbackUploadParams.extra_log_files` 是任意 `Vec<PathBuf>`。App Server：

- 不校验路径是否位于 Codex home、当前 workspace 或 rollout root；
- 不 canonicalize 后检查 symlink escape；
- 不限制文件数量、单文件大小或总大小；
- 即使 `include_logs=false`，仍然无条件追加并读取 `extra_log_files`。

TUI 自己只在用户同意日志时传当前 rollout，所以官方 UI happy path 看起来安全；但任何能调用 App Server RPC 的 client 都可以绕过该同意流，把任意可读本地文件作为反馈附件上传。这里必须把 `feedback/upload` 视为 host-level filesystem egress RPC，而不是普通 telemetry RPC。

### 4.2 同意页不是服务端授权

注释已经说明 `FeedbackUploadOptions` 假设 caller 先完成用户同意。该假设只存在于调用约定里，协议和 App Server 没有可验证的 consent token、attachment manifest hash 或 capability。

更稳的设计是两阶段协议：

```text
feedback/prepare(threadId)
  -> server 解析并冻结可发送附件 manifest
  -> UI 展示 filename / kind / bytes / sensitivity
  -> user confirms manifestHash
feedback/commit(operationId, manifestHash, note)
  -> server 只读取已冻结、仍满足 identity 的 artifact
```

### 4.3 环境诊断会原样带出代理凭据

`feedback_diagnostics.rs::collect_from_pairs` 把 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 及小写变体的值原样写入附件。测试 `collect_from_pairs_reports_raw_values_and_attachment` 甚至明确断言包含：

```text
https://user:password@secure-proxy.example.com:443?secret=1
```

TUI 对非 Good Result 会把这些值直接展示在同意页，Good Result 则不显示 connectivity details，但只要用户选择上传日志，附件仍会包含原始值。环境诊断应只保留 scheme、host、port、变量是否存在等结构化字段，必须删除 userinfo、query 和 fragment。

### 4.4 Process-global ring 与 Thread-scoped consent 不一致

UI 文案是“current Codex session logs”，实际 ring 是整个进程最近 4 MiB TRACE。Thread ID 只是标签，不是过滤条件。这会造成两类问题：

- 数据隔离：同进程其他 Thread / account 的日志可能被当前反馈带出；
- 可解释性：上传者无法从同意页得知真正的数据范围。

可选修复包括 per-Thread ring、日志事件强制带 owner 后在 snapshot 过滤，或 consent 文案明确为 process diagnostics。对于云端多租户 Agent，第一种才是可接受默认值。

### 4.5 先读取全部附件，再整体发送

所有 path-backed file 都通过 `fs::read` 一次性进入内存，然后复制进 Sentry attachment。8 个 rollout 加 Guardian、sandbox、client extras 和 doctor report 只有 Thread 数上限，没有总字节预算，可能造成高峰内存和长时间 blocking worker 占用。

读取时还会跟随 symlink，并存在 manifest 展示与实际读取之间的 TOCTOU。上传系统应使用已打开文件句柄或 immutable artifact lease，并在 prepare 阶段冻结 size、identity 和 hash。

### 4.6 回执语义过强

Sentry `flush` 的返回结果没有被检查，App Server 只返回 `thread_id`，TUI 显示 “Feedback uploaded”。从现有代码最多能证明 envelope 被交给 client 并尝试 flush，不能证明远端接受，更不能证明哪些附件成功读取。

返回值应至少包含：

```ts
interface FeedbackReceipt {
  operationId: string;
  eventId?: string;
  status: 'accepted' | 'unknown' | 'failed';
  attachments: Array<{
    artifactId: string;
    filename: string;
    bytes: number;
    sha256: string;
    status: 'uploaded' | 'skipped' | 'failed';
  }>;
}
```

## 5. 测试证据与缺口

### 已有测试

| 测试 | 证明了什么 |
| --- | --- |
| `ring_buffer_drops_front_when_full` | ring 保留最后 N 字节 |
| `logger_layer_excludes_responses_websocket_timing_payloads` | 一个明确高敏 target 不进入 ring |
| `metadata_layer_records_tags_from_feedback_target` | structured tag 能进入快照 |
| `feedback_attachments_gate_connectivity_diagnostics` | connectivity attachment 受 `include_logs` 控制，且附件顺序稳定 |
| `path_backed_attachments_use_binary_content_types` | gzip 与未知二进制 MIME 推断正确，即使 `include_logs=false` 也能添加 path attachment |
| `upload_tags_include_client_tags_and_preserve_reserved_fields` | 保留字段不可被 client/process tag 覆盖 |
| `doctor_report_tags_summarize_status_counts` | doctor tag 低基数汇总 |
| `build_feedback_upload_params_omits_rollout_path_without_logs` | 官方 TUI 不在拒绝日志后传 rollout |
| feedback consent snapshot tests | 同意页展示 doctor、sandbox 与 rollout 文件名 |

### 应补的边界测试

1. RPC 直接传 `includeLogs=false + extraLogFiles=[secret]` 时必须拒绝。
2. absolute path、`..`、symlink escape、FIFO、device file 和运行中被替换文件。
3. 单文件、附件数量和总字节上限；读取前就拒绝，不能先分配再检查。
4. Thread A 上传时 ring 中混入 Thread B/account B 的事件。
5. 用户确认后 rollout 被替换，manifest hash 不一致时拒绝 commit。
6. Sentry flush timeout、partial attachment read 和远端 rejection 的 receipt 状态。
7. proxy URL 含 userinfo/query/fragment 时只能上传脱敏结构。
8. descendant 超过 8 个时，回执明确列出被截断 Thread，而不是只写 warning。

## 6. 架构解释

反馈系统本质上是一个**经用户确认的数据导出 transaction**，不是普通日志函数。它需要四层共同成立：

1. Policy：当前 client 是否有资格发起反馈和读取哪类 artifact；
2. Consent：用户确认的精确 manifest；
3. Artifact ownership：文件内容在确认与发送之间保持身份不变；
4. Receipt：结果区分 accepted、unknown、failed 和 partial。

Codex 当前的优秀之处在于 UI 选择、增强诊断失败隔离、tag ownership、Thread 结果路由和 bounded ring；主要缺口是这些局部优点还没有被一个端到端 operation identity 串起来。

## 7. 迁移建议

对当前 NestJS Agent，不应照搬 Sentry 或本地 PathBuf，但应迁移以下思想：

- 反馈文本与敏感运行证据分开同意；
- canonical tags 由服务端拥有，客户端只能补 allowlist 字段；
- optional diagnostics 失败不能否认主反馈；
- feedback operation 绑定 `tenantId + userId + conversationId + agentRunId + operationId`；
- 附件只能引用服务端生成的 artifact ID，绝不接受任意本地/对象存储路径；
- 明确记录导出 manifest、脱敏版本、hash、大小、状态和审计 receipt；
- 多租户日志必须先按 owner 隔离，再谈 ring 大小和上传便利性。

当前项目只需要理解并记录这些约束；在尚未实现反馈上传前，不需要提前搭建完整 artifact transaction。

## 8. 推荐阅读顺序

1. `tui/src/bottom_pane/feedback_view.rs`：先理解产品承诺与 consent 文案。
2. `tui/src/app/background_requests.rs::{build_feedback_upload_params,submit_feedback}`：看 UI operation 如何变成 RPC。
3. `app-server-protocol/src/protocol/v2/feedback.rs::FeedbackUploadParams`：检查协议实际授予了什么能力。
4. `app-server/src/request_processors/feedback_processor.rs::upload_feedback_response`：沿数据收集主链追踪 owner 与 fallback。
5. `feedback/src/lib.rs::{CodexFeedback,FeedbackSnapshot}`：理解 process-global ring、tag 合并与附件读取。
6. `feedback/src/feedback_diagnostics.rs`：核对环境值是否脱敏。
7. `app-server/src/request_processors/feedback_doctor_report.rs`：学习 best-effort enrich step。
8. 回到上述测试，分别验证 happy path 与权限/隐私缺口。

## 9. Teach-back

1. 为什么 `includeLogs=false` 仍不能证明请求不会读取本地文件？
2. 4 MiB ring 限制了什么，又没有限制什么？
3. 为什么 Thread ID 放进 Sentry tag 不等于日志已经按 Thread 隔离？
4. doctor report 的失败隔离为什么是好设计，怎样避免它变成静默数据缺失？
5. 为什么反馈上传需要 manifest hash 和 operation receipt，而不只需要一个 boolean consent？
