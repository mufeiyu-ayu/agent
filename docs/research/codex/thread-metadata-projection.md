# Thread Metadata Projection：Title、Preview、Git 与 Recency 的多源事实

本文研究 Codex 如何从 rollout、live runtime、SQLite、legacy name index 和显式客户端 patch 组合 Thread 列表元数据。重点不是字段清单，而是“用于发现和排序的投影”与“可恢复的会话事实”之间的边界。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`

## 1. Metadata 是查询投影，不是单一 canonical record

Thread 列表最终可能组合：

- rollout `SessionMeta` 中的创建信息、cwd、Git、history mode。
- `TurnContext` 中最近观察到的 model、effort、permission。
- UserMessage 派生的 preview、first user message 与 title。
- TokenCount 派生的 usage。
- ThreadGoal 派生的 preview fallback。
- SQLite 中可筛选、排序、搜索的 materialized metadata。
- 独立 legacy thread-name index。
- loaded Thread 的 session ID 与实时 status。

因此 `Thread` response 是 product projection。某个字段出现在 response 中，不代表它只存在于一个存储，也不代表所有存储已经同步到同一 generation。

## 2. LiveThread 把 rollout append 与 metadata observation 串在一起

`LiveThread.append_items()` 的顺序是：

1. append rollout items。
2. `ThreadMetadataSync.observe_appended_items()` 生成 patch。
3. 调用 ThreadStore 更新 metadata。
4. generation仍匹配时清除 pending patch。

显式 metadata update 会先 flush pending observation，再应用调用者 patch。这避免旧的 derived patch 在显式修改之后迟到覆盖。

`PendingThreadMetadataPatch.generation` 也防止以下竞态：一次 patch 正在落库时，新 rollout item 又合并了更新；旧完成只能清除自己那一代，不能误删新 pending patch。

这是非常值得学习的“coalesced projection + generation ack”模式。

## 3. 空 Thread 不急于物化列表行

新建 LiveThread 时，create metadata patch 先保存在 sync 内部，`defer_create_update_until_history_exists = true`。如果 Thread 从未产生 rollout history，shutdown 不会仅为了空会话 materialize metadata。

这能避免用户误触创建大量空 Thread 列表项，也让“存在 Thread handle”与“存在可恢复会话”保持区别。

Resume 时从历史观察到的 repair patch 也可延迟到下一次 append，避免只读 resume 自动把所有旧历史重写一遍。

代价是 list/read/store 在生命周期早期不能假设 ThreadManager 中每个 live handle 都已有 SQLite row。

## 4. Preview、First User Message 与 Title 的职责

首次 UserMessage 会产生：

- `first_user_message`：保留最早可用的用户输入摘要。
- `preview`：若之前没有 goal preview，则作为列表预览。
- `title`：去除用户消息前缀后的 best-effort 标题。

ThreadGoal 可以在尚无用户消息时先提供 preview，但不会抢占 title。后续正常 user message 仍可成为 title。

这里体现了两个不同产品问题：

```text
preview = 这条会话大致在做什么？
title   = 用户如何命名/识别这条会话？
```

不要用一个 `name` 字段同时承担即时摘要、用户显式命名、搜索 title 和模型生成标题，而不记录 provenance。

## 5. 显式 Name 与派生 Title 在 SQLite 中复用了同一列

`thread/name/set` 会 trim 输入并拒绝空字符串，然后以 `ThreadMetadataPatch.name = Some(Some(name))` 更新。Local store 把它写进 SQLite `metadata.title`，同时 append legacy name index。

列表读取时，只有 SQLite title 非空且不等于 `first_user_message`，才把它视为 distinct user-facing name；否则会回退 legacy name index。Thread response 又只有在 title 不等于 preview 时才设置 `name`。

这套兼容逻辑避免默认 title 与 preview 重复显示，但也说明显式 name 与 derived title 没有独立字段/provenance。若用户刻意把名称设成与首条消息完全相同，它可能被启发式当作非显式 title。

更稳的数据模型应拆成：

```ts
type ThreadNaming = {
  explicitName?: string;
  generatedTitle?: string;
  preview?: string;
  firstUserMessage?: string;
};
```

投影层再决定展示优先级。

## 6. Name 写入跨两个索引

显式 name 的 Local store 路径：

1. 通用 `apply_metadata_update()` 先把 SQLite title 写成新值。
2. 确保 live rollout 已 materialize，并 reconcile metadata。
3. 再调用 `apply_thread_name()` 更新 SQLite title。
4. append legacy name index。

如果 legacy index append 失败，RPC 返回 error，但 SQLite 可能已经是新 title。客户端重试不是纯 no-op；读取路径又可能因 SQLite/legacy可用性不同看到不同来源。

这属于兼容期 dual-write partial commit。理想做法是：

- 选一个 canonical naming store。
- legacy index 作为可重建 projection。
- response 返回 canonical version/receipt。
- background reconciliation 修复 projection，而不是让用户写请求承担双提交。

## 7. Name 输入只有 trim 约束

`normalize_thread_name()` 只做 trim 与 empty rejection，没有专用：

- 字符/UTF-8 bytes 上限。
- control/escape/bidi policy。
- newline 处理。
- grapheme/display width 上限。

这些值会进入 SQLite、JSON/legacy index、WebSocket notification、列表和终端 UI。每个 renderer 各自截断或清洗会形成不一致。

用户可见 metadata 应在 canonical write boundary 规范化，并同时保留原值/规范化值的产品策略；不能只依赖某个 UI 防御。

## 8. Git metadata patch 有正确的三态语义

`thread/metadata/update` 的 `sha`、`branch`、`originUrl` 使用 double option：

```text
field omitted -> unchanged
field: null    -> clear
field: value   -> replace
```

handler 拒绝完全空的 `gitInfo`，并 trim 非空字符串。这比把空字符串同时当“清除”和“无修改”清晰得多。

Store 的 `GitInfoPatch.merge()` 也保留 field presence：新的 omitted 不覆盖旧 pending patch，而显式 `Some(None)` 能覆盖成 clear。

这是 TypeScript/NestJS DTO 中值得直接学习的 PATCH 语义。

## 9. Git value 仍只是调用者声明

入口没有验证：

- SHA 是否是合法 hex、长度是否合理。
- branch 是否符合 Git ref 规则。
- origin URL scheme/host/credential/userinfo。
- 字段 bytes、control chars 与 newline。
- 这些 Git 值是否确实属于 Thread cwd 当前仓库。

该接口的典型调用者可能先执行本地 Git probe 再写 metadata，但 API 本身接收的是 claim，不是 observation proof。

如果 branch/title 会驱动安全决策或外部链接，必须由受信 executor 重新 observe；如果只用于展示，也要标记 `source: client-observed` 与 observedAt/repo identity。

## 10. 显式 Git 更新是强一致写，而观察型 metadata 是 best-effort

Store 区分两类 patch：

### Observed metadata facts

由 rollout/transcript 派生，如 preview、model、cwd、token usage、first user message。SQLite internal error 通常只 warning，避免可选查询 DB 故障让 canonical JSONL transcript 看起来写失败。

### Explicit Git-only patch

部分 patch 必须读取 SQLite 现值以保留 omitted fields，因此 SQLite 写失败会阻断请求。

这是很好的 failure-classification：canonical durable fact 与 repairable query projection 不应共享完全相同的失败策略。

但分类依赖 patch 内容；若一个 patch 同时包含 observed facts 和 Git，Git 的严格性可能被 `has_observed_metadata_facts()` 影响。调用方最好不要把不同权威等级的字段混成一个写操作。

## 11. Git dual-write 也有 partial commit 窗口

Legacy history 显式 Git 更新会：

1. 先在 `apply_metadata_update()` upsert SQLite Git 字段。
2. 读取合并后的完整 Git tuple。
3. append 新 `SessionMeta` 到 rollout。
4. 再调用 SQLite `update_thread_git_info()`。

若第 3 步失败，SQLite 已新、rollout 仍旧，RPC 返回 error。若第 4 步失败，rollout 已新、RPC仍返回 error。重试可能追加重复 SessionMeta。

当前实现用 Thread ID校验、完整 tuple rewrite 和后续 reconcile 提高可恢复性，但没有跨存储事务或 operation receipt。

对云端服务更适合使用 canonical DB transaction；event/log projection从同一 outbox异步生成。

## 12. Paginated history 暂不接受兼容性 metadata 更新

Name、memory mode 和显式 Git patch 需要写 legacy rollout/name compatibility state。Local store 在任何一侧 mutation 前先拒绝 Paginated history mode。

这是好的 fail-before-mutation：未完成的 store 能力不会默默只写一半。

它也暴露了迁移前置条件：新 history store 不只是实现 Turn/Item分页，还必须定义 Thread-level mutable metadata 的 canonical 写入、版本和 legacy compatibility退场方案。

## 13. Missing SQLite row 可以从 rollout 修复

Metadata update 发现 SQLite row缺失时，会：

- 解析 active/archived rollout path。
- 从 canonical SessionMeta重建 history mode 与基础 metadata。
- 校验 SessionMeta Thread ID。
- 保留 archived 标记。
- 再应用 patch。

测试覆盖 stored、loaded 和 archived Thread 的 row repair，并确认不会把已有 summary 清空。

这是 production-grade repair path：查询索引可重建，而不是因为 projection row缺失就宣布 Thread 不存在。

不过 repair 读取与 patch 写入之间没有 history revision CAS；并发 append 仍可能让 repaired row来自较旧 snapshot，随后由 metadata sync再追平。

## 14. CreatedAt、UpdatedAt 与 RecencyAt 要分开

Codex 列表提供三种 sort key：

| 字段 | 含义 |
| --- | --- |
| `createdAt` | Thread 初次创建时间 |
| `updatedAt` | metadata / rollout 最近发生变化的时间 |
| `recencyAt` | 产品列表中应前移的最近用户运行活动 |

`TurnStarted` 会推进 recency；后续 commentary、tool output、token count 和 TurnComplete 继续推进 updatedAt，但不继续推进 recency。

这避免一个长时间运行的后台 Turn 因持续输出而不断霸占“最近会话”顶部，同时仍允许系统知道它最近有写入。

当前项目的 Conversation 列表若只使用 `updatedAt`，后台 step/log/usage 写入可能让旧会话不断置顶。应单独设计 `lastUserActivityAt` 或 `recencyAt`。

## 15. Touch 有节流，事实 patch 不丢

与 metadata 无关的 rollout item 只产生 updatedAt touch。若距离上次 touch 落库不足固定 interval，且 pending patch 不含真正 metadata facts，sync 可以跳过这次 SQLite write。

一旦 patch 包含 preview/model/token等事实，就不会被纯 touch节流吞掉。pending merge 会保留字段并推进 generation。

这是合理的 write amplification 控制：

```text
high-frequency append
  -> canonical rollout always writes
  -> query projection touch coalesces
  -> semantic metadata changes bypass throttle
```

## 16. List 是 scan-and-repair 或 DB-only 两种一致性模式

`thread/list` 默认允许扫描 JSONL rollout 来修复 metadata；`useStateDbOnly = true` 则只从 State DB返回，减少 I/O但可能漏掉尚未投影/损坏的 Thread。

这个 flag 实际上不是单纯性能开关，而是 completeness contract：

```ts
type DiscoveryMode =
  | { kind: "repairing"; mayScanRollouts: true }
  | { kind: "indexed"; mayBeIncomplete: true; checkpoint?: number };
```

API response 当前没有返回 projection checkpoint 或 completeness 标记，调用者只能通过请求参数自行记住可信度。

## 17. Name attachment 是二次查询，页面不是同一快照

List 先获得 Thread page，再为页面 Thread IDs逐个查 SQLite title；缺失时批量查 legacy name index，最后 attach name。

在 page query 与 name query 之间：

- 另一个客户端可能改名。
- SQLite row可能被 repair。
- legacy index可能刚 append。
- Thread可能 archive/delete。

因此 page ordering/filtering 使用的 title generation 与最终展示 name不一定一致。尤其 searchTerm在底层 query过滤 title后，attach 阶段可能换成另一个 name来源。

稳定搜索结果应返回 index revision，或把 canonical explicit name直接放进同一查询行。

## 18. Search 的两阶段策略

`thread/search` 先用 `rg` 搜 rollout contents得到 matching paths/snippet，再按排序条件分页扫描 Thread index并与 path集合求交。为凑满一页，每次扫描 `pageSize * 8`，clamp 到 256–2048。

优点：

- 复用 rollout全文，不必立刻构建全文索引。
- 最终仍按 Thread sort key排序。
- compressed/plain path 先转 logical path匹配。

边界：

- `rg` 结果集先全量驻内存，没有 search candidate总量 cap。
- 为找一页结果可能扫描许多 index pages。
- 某些 snippet需再次读 rollout。
- search/list期间文件与DB可变化，不是 snapshot。
- cursor parse error仍回显原始 cursor。

适合本地中等规模，不应直接照搬到多租户云端全文搜索。

## 19. 云端 Agent 的建议模型

```ts
type ConversationMetadata = {
  conversationId: string;
  explicitName: string | null;
  generatedTitle: string | null;
  preview: string | null;
  firstUserMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  recencyAt: Date;
  version: number;
};

type ObservedRepository = {
  repositoryId: string;
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
  observedAt: Date;
  observedBy: "trusted-worker" | "client-claim";
};
```

规则：

1. user-authored name 与 derived title分列。
2. query projection 有 version/checkpoint。
3. PATCH 使用 absent / null / value 三态并带 expectedVersion。
4. Git observation绑定 repository identity 和 provenance。
5. `recencyAt` 只由明确产品事件推进。
6. 全文索引是可重建 projection，canonical messages/runs不依赖它写成功。
7. DB transaction + outbox替代用户请求中的多文件 dual-write。

## 20. 对当前项目的学习结论

当前阶段不需要实现复杂搜索或多索引 repair，但可以提前避免两个结构性问题：

- 不要让任意 AgentStep/usage更新都修改 Conversation 列表的排序时间。
- 不要把显式名称、模型生成标题和首条消息摘要塞进同一个无法区分来源的字段。

Codex 最值得学习的是 metadata observation与rollout同序、pending generation ack、空Thread延迟物化、projection failure best-effort、missing-row repair和独立 recency；需要谨慎借鉴的是 SQLite/rollout/name-index dual-write、输入规范化不足和多阶段 list/search的非快照语义。
