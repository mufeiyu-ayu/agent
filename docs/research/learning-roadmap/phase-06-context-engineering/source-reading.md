# Phase 06 源码阅读：ContextManager 如何维护合法历史

## 1. 阅读问题

> Codex 为什么不直接把 UI transcript 或 rollout 全量发给模型？它如何记录、规范化、估算、裁剪和压缩 model-visible history？

本次阅读聚焦 Context 的职责和不变量。不要先深入 tokenizer 精度、图片编码或远程 compaction provider 的所有实现。

## 2. 定位命令

```sh
rg -n "record_items|for_prompt|estimate_token_count|normalize_history" \
  /Users/lihaoran/Desktop/codex/codex-rs/core/src/context_manager

rg -n "run_auto_compact|run_inline_auto_compact_task|build_compacted_history" \
  /Users/lihaoran/Desktop/codex/codex-rs/core/src/session/turn.rs \
  /Users/lihaoran/Desktop/codex/codex-rs/core/src/compact.rs
```

研究基线：Codex fork `ab6a7eb87`。

当前快照新增的优先入口是 `codex-rs/core/src/compact_token_budget.rs`：manual 与 inline auto-compaction 都被建模为 `ContextCompaction` 生命周期，运行 compact hooks 并建立新 window。配套读 `core/tests/suite/token_budget.rs` 的 mid-turn follow-up 与 `compact_resume_fork.rs` 的 model-history-view 一致性，避免把 compaction 误解为“删除旧消息”。

## 3. 第一条链：历史如何进入模型

### 3.1 ContextManager 主对象

| Codex 文件 | 重点符号 | 阅读目标 |
| --- | --- | --- |
| `codex-rs/core/src/context_manager/history.rs` | `ContextManager`，约 38 行 | 它拥有什么状态？revision/baseline 有何意义？ |
| 同文件 | `record_items`，约 121 行 | item 在进入 history 前做什么处理？ |
| 同文件 | `for_prompt`，约 141 行 | 为什么发送前还要 normalize？ |
| 同文件 | `estimate_token_count`，约 162 行 | token 是如何估算而非假装精确？ |
| 同文件 | `replace`，约 200 行 | compaction/rollback 后如何替换 history？ |
| 同文件 | `drop_last_n_user_turns`，约 256 行 | 为什么裁剪按 Turn 语义而非随便 pop item？ |
| 同文件 | `normalize_history`，约 359 行 | call/output 和模态不变量在哪里收口？ |

按下面流程画图：

```text
runtime canonical items
  -> record_items(truncation policy)
  -> ContextManager internal history
  -> clone / for_prompt
  -> normalize
  -> provider request input
```

关键观察：`for_prompt` 在副本上规范化，不意味着把每次 provider 兼容处理都覆盖回原始持久事实。当前项目也应区分 canonical facts 与本次 model projection；数据库读取后必须保持一次 Turn 的 item stream 顺序，不能把 Message、ToolCall、Observation 分类查询后按类型重新拼装。

### 3.2 Normalize 独立实现

继续阅读：

- `codex-rs/core/src/context_manager/normalize.rs`
- `codex-rs/core/src/context_manager/updates.rs`
- `codex-rs/core/src/context_manager/history_tests.rs`

阅读问题：

1. 如何处理孤立 tool output？
2. tool call 与 output 用什么 ID 配对？
3. provider 不支持某种 input modality 时在哪里过滤？
4. history rewrite 为什么要更新 revision/baseline？
5. 截断是记录时发生、发送前发生，还是两者都有？职责如何区分？
6. 同一 Turn 内 message/call/output 的相对顺序由什么保证，normalize 哪些修复不能演变成任意重排？

## 4. 第二条链：一次 Turn 何时触发压缩

### 4.1 Turn 外层循环

| Codex 文件 | 位置 | 阅读目标 |
| --- | --- | --- |
| `codex-rs/core/src/session/turn.rs` | `run_turn`，约 142 行起 | compaction 与正常 sampling 的相对位置 |
| 同文件 | sampling 后 token status，约 316-349 行 | follow-up 前为什么检查预算？ |
| 同文件 | `run_pre_sampling_compact`，约 797 行 | 第一轮采样前何时压缩？ |
| 同文件 | `run_auto_compact`，约 917 行 | local/remote compact 如何作为可替换实现？ |

跟踪两种触发：

- pre-sampling：旧 history 已经接近/超过阈值。
- mid-turn follow-up：模型或工具续跑后需要下一次 sampling，预算不足。

当前项目第一版不必复制所有触发，但要学会“触发条件属于 runtime/budget policy，不属于 Vue 消息条数”。

### 4.2 Compaction 主流程

| Codex 文件 | 符号 | 阅读目标 |
| --- | --- | --- |
| `codex-rs/core/src/compact.rs` | `run_compact_task_inner` | compaction 的生命周期与事件 |
| 同文件 | `run_compact_task_inner_impl`，约 220 行 | summary/新 history 如何生成并替换 |
| 同文件 | `build_compacted_history`，约 585 行 | 哪些 user message / summary 被保留 |
| 同文件 | `build_compaction_initial_context` | 初始指令为何不能被意外丢失 |
| `codex-rs/core/src/compact_tests.rs` | 单元/集成 tests | 成功、预算、构造顺序的约束 |
| `codex-rs/app-server/tests/suite/v2/compaction.rs` | 端到端 tests | started/completed item 与触发行为 |

记录三点：

1. compaction 自己也是可观察的 runtime action。
2. 新 history 只有在 candidate 成功后才替换旧 history。
3. summary 需要与初始指令、当前 user turn 的顺序相容。

## 5. 第三条链：token budget 如何进入运行决策

按顺序阅读：

- `codex-rs/core/src/session/token_budget.rs`
- `codex-rs/core/src/compact_token_budget.rs`
- `codex-rs/core/src/context/token_budget_context.rs`
- `codex-rs/core/src/state/auto_compact_window.rs`

阅读重点不是复制算法，而是提炼：

- context window 与 usable input budget 不同。
- completion/output 必须预留。
- 不同模型/provider 可能有不同 compaction 能力。
- token status 是运行状态的一部分，可用于事件/telemetry。
- 估算值需要 safety margin。

## 6. 必读测试切片

### Context invariants

在 `history_tests.rs` 中用 `rg` 找：

```sh
rg -n "orphan|tool|function|normalize|truncate|image|drop|rollback" \
  /Users/lihaoran/Desktop/codex/codex-rs/core/src/context_manager/history_tests.rs
```

至少选取：

- call/output 配对。
- orphan output 处理。
- 大 output 截断。
- 不支持模态过滤。
- rollback/drop turns 后合法性。

### Compaction lifecycle

在 `app-server/tests/suite/v2/compaction.rs` 阅读：

- auto compaction started/completed 通知。
- manual compaction。
- compaction metadata/turn id。
- source history 被替换后的对外投影。

测试是最直接的架构文档：它们告诉你哪些顺序和事件被认为是公共行为。

## 7. 当前项目反向阅读链

### 7.1 Context 构造入口

```text
SeoService.chatStream
  -> AgentRuntimeService.runTurnStream
  -> listRecentChatMessages(limit=12)
  -> buildModelMessages callback
  -> SeoContextBuilder
  -> buildSeoAgentChatMessages
  -> LLMService.chatStream
```

逐个阅读：

| 当前文件 | 观察点 |
| --- | --- |
| `apps/api/src/seo/seo.service.ts` | `CHAT_HISTORY_LIMIT=12` 是哪一层的策略？同步与 stream 是否重复？ |
| `apps/api/src/agent-runtime/agent-runtime.types.ts` | builder 只收/返 `ChatMessage[]`，能否表达 tool facts？ |
| `apps/api/src/agent-runtime/agent-runtime.service.ts` | 当前 user message 何时写入、何时又被读取？ |
| `apps/api/src/seo/seo-context-builder.service.ts` | 当前只是 prompt wrapper，哪些职责应通用化？ |
| `apps/api/src/seo/prompts/seo-agent.prompt.ts` | system prompt 的版本和预算如何记录？ |
| `apps/api/src/llm/llm.types.ts` | provider-neutral 类型目前表达什么、缺什么？ |
| `apps/api/src/llm/clients/openai-compatible.client.ts` | SDK message shape 泄漏在哪个边界？ |

### 7.2 Message 与执行事实

阅读 `prisma/schema.prisma`，按状态逐项回答：

- COMPLETED user/assistant Message 是否进入 history？
- FAILED assistant 的兜底错误文案是否是业务事实？
- ABORTED assistant 的部分文本是否可靠？
- STREAMING placeholder 在恢复时如何处理？
- AgentStep 的 input/output 是否应直接全量发给模型？
- ToolCall/Observation/Approval/Summary 未来分别从哪里投影？
- ToolCall/Result/Observation 是否各自有 canonical DB fact、`turnId` 与单调 item sequence，还是只有活 runtime 的内存对象？

### 7.3 两条运行路径

`SeoService.chat()` 直接调用 `LLMService.chat()`，`chatStream()` 才走 `AgentRuntimeService`。阅读时把两条路径画在一张图上，标出：

- 谁创建 Message。
- 谁构造 context。
- 谁记录 Run/Step。
- 谁处理 cancel。
- 谁最终写 assistant Message。

结论应是逐步统一到一条 application runtime，而不是在两个方法中各自复制 token budget 与 compaction。

## 8. Codex -> 当前项目翻译表

| Codex | 当前项目建议 | 说明 |
| --- | --- | --- |
| `ResponseItem` history | 最小 `ModelInputItem` union | 不复制所有代码 Agent item |
| `ContextManager` | `AgentContextBuilder + Normalizer` | PostgreSQL facts 投影到本轮输入 |
| truncation policy | source budget + tool projector | SEO 数据按业务重要性裁剪 |
| token estimate | 可注入 TokenEstimator | 初期允许保守估算 |
| local/remote compaction | versioned ContextSummary | 先做单一 summarizer 实验 |
| rollout history | PostgreSQL Message/Run/Tool facts | 不增加 JSONL 双写 |
| world state | SEO business context contributor | URL/关键词/页面分析等结构化事实 |

这里的 PostgreSQL `Tool facts` 至少包括可重建 ToolCall、ToolResult 和 Observation。摘要范围使用 model-visible conversation item sequence，不使用只覆盖聊天气泡的 Message ID；Approval 当前状态是可变 projection，不能被 summary 文本当作永远有效的事实。

## 9. 推荐阅读顺序

### 第一遍：合法 history

1. `history.rs::ContextManager`
2. `record_items`
3. `for_prompt`
4. `normalize_history`
5. `history_tests.rs` 的 call/output cases
6. 当前 `llm.types.ts`、`seo-context-builder.service.ts`

产物：ModelInputItem 草图 + canonical Tool facts 草图 + Turn item ordering 在内的 normalization 不变量。

### 第二遍：预算

1. `estimate_token_count`
2. `session/token_budget.rs`
3. `turn.rs` sampling 后 token status
4. 当前固定 12 条查询

产物：input budget 公式 + source priority 表。

### 第三遍：compaction

1. `turn.rs::run_pre_sampling_compact`
2. `compact.rs::run_compact_task_inner_impl`
3. `build_compacted_history`
4. `compact_tests.rs`
5. app-server `compaction.rs`

产物：candidate -> validate -> atomic replace 状态图。

## 10. 阅读时必须记录的事实

```md
### Context source：tool observation

- Canonical source：
- Model-visible type：
- Inclusion priority：
- Token estimate：
- Truncation rule：
- Pairing/order invariant：
- Sensitive fields：
- Test evidence：
```

为 system、summary、message、business context、tool pair、current input 各填一次。

## 11. 必须回答的问题

### Codex 侧

1. `record_items` 与 `for_prompt` 为什么是两个阶段？
2. 为什么 normalize 在发模型前仍然必要？
3. history rewrite 时 revision/baseline 的作用是什么？
4. compaction 为什么既有 started 又有 completed item？
5. 压缩失败时旧 history 如何保留？
6. mid-turn compaction 为什么必须考虑最后一条 user message 的位置？

### 当前项目侧

1. 当前 user input 是否可能被读取两次？如何用测试证明只出现一次？
2. `MessageStatus.FAILED` 的内容为什么不应默认进入 model history？
3. ToolCall/Observation 应从哪种 persistent fact 构造？
4. `SeoContextBuilder` 应保留哪些领域职责，放弃哪些通用职责？
5. model context window、completion reserve 和 safety margin 从哪里配置？
6. 一个 2 MB SEO crawl 结果如何变成受限 observation？
7. summary 的 item-sequence 覆盖范围如何防止与 recent history 重复，并覆盖 Message 之外的 tool facts？
8. summary 生成后 Approval 状态变化时，为什么必须用当前 canonical projection/observation 覆盖旧摘要描述？

## 12. 可跳过内容

- base64 图片精确 token 估算。
- Codex world-state 的全部 shell/environment diff。
- remote compaction v1/v2 provider 差异。
- hooks 在 compaction 前后的完整插件机制。
- 不同模型 compatibility hash 的所有迁移分支。
- UI 对 compaction item 的具体渲染。

当前 SEO Agent 真正需要时再回读。

## 13. 阅读完成证据

- [ ] 画出 canonical facts -> context plan -> provider request。
- [ ] 能说出 `record_items` 与 `for_prompt` 的职责差异。
- [ ] 找到 call/output normalization 测试。
- [ ] 找到 compaction 触发、替换和端到端事件证据。
- [ ] 为当前项目列出各 Message 状态的 history 规则。
- [ ] 画出 ToolCall/ToolResult/Observation canonical rows -> ordered Turn item stream -> provider input，并设计 fresh-runtime DB rebuild test。
- [ ] 明确 summary item-sequence range 与 mutable Approval overlay 规则。
- [ ] 写出 input budget 公式与 source priority。
- [ ] 明确同步/stream 两条路径应如何收敛。
- [ ] 列出至少四项不照搬 Codex 的实现细节。
