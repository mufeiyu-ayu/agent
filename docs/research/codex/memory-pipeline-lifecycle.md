# Memory Pipeline 生命周期：抽取租约、Git 基线、引用反馈与遗忘边界

本文研究 Codex 实验性 Memories 系统如何从历史 Thread 中抽取候选记忆，如何用一个受限 Agent 合并为长期知识，以及下一次 Turn 如何读取并反馈使用情况。重点不是“把聊天记录做成向量库”，而是长期记忆作为异步派生数据时的所有权、版本、失败恢复与隐私边界。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/memories/{write,read}/src/**`、`codex-rs/ext/memories/src/**`、`codex-rs/state/src/runtime/memories.rs`、`codex-rs/core/src/{memory_usage,stream_events_utils}.rs`

## 1. Memory 不是原始事实，而是可重建的派生投影

当前数据流可概括为：

```text
canonical rollout + Thread metadata
  -> Phase 1：逐 Thread 抽取 raw memory + summary
  -> SQLite Stage1 output
  -> Phase 2：选择、同步 workspace、计算 Git diff
  -> 受限 consolidation Agent
  -> MEMORY.md + memory_summary.md + rollout summaries
  -> Turn context / dedicated memory tools
  -> model memory citations
  -> SQLite usage_count / last_usage
  -> 下一轮 Phase 2 selection
```

Rollout 才是用户交互事实；Stage 1、Stage 2 文件和 usage ranking 都是可以失效、重新计算或删除的投影。这个定位比“Memory 就是另一份聊天数据库”更稳，因为投影失败不应破坏原会话。

## 2. 启动任务先做资格判断，但额度保护是 fail-open

`start_memories_startup_task()`会跳过：

- ephemeral Thread。
- `MemoryTool` feature 未开启。
- 非 root Agent。
- 没有 State DB。

启动时还会 best-effort 创建根目录、写 extension instructions，并在额度判断前清理过期 Phase 1 输出。真正的抽取与合并在后台 Tokio task 中运行，不阻塞普通 Turn 启动。

Rate-limit guard 只有成功取得 Codex backend 的有效额度快照时才能判断剩余比例；缺认证、非 Codex provider、请求失败或无快照都会返回未知，而调用方把未知当作允许启动。这保证 Memory 故障不阻断主产品，但也意味着“保护模型额度”不是 fail-closed guarantee。

## 3. `generate_memories` 与“本次是否启动后台任务”不是同一个开关

当前启动函数没有简单地以本 Thread 的 `generate_memories=false`直接返回。Thread metadata 会记录 memory mode，Phase 1 查询只选择允许生成记忆的历史 Thread；Phase 2也可以继续合并此前已有的输出。

因此应区分：

- 当前 Thread 是否可以成为记忆来源。
- 当前进程是否可以维护已有 Memory 投影。
- 当前 Turn 是否允许使用 Memory。

把三个语义塞进一个布尔配置，会让关闭“使用”意外停止后台清理，或关闭“生成”却继续采集本 Thread。

## 4. Phase 1 用数据库租约声明 Thread 抽取所有权

候选只来自：

- active、interactive、legacy rollout Thread。
- memory mode enabled。
- 允许的 SessionSource。
- 位于最大年龄窗口内。
- 已空闲超过 cutoff。
- 不是当前 Thread。

State DB 扫描有5000条上限，最终 claim 数再受配置限制。每个任务带 owner token 与3600秒 lease，数据库同时限制全局 running 数；进程内以8并发执行。

Claim 后的成功/失败更新都要匹配 owner token。这比“查出pending后直接处理”更可靠：多个进程可以竞争，但只有当前租约所有者能提交。

## 5. Phase 1 没有持续 heartbeat，长抽取可能被误判过期

Phase 2合并期间每90秒续租，但 Phase 1 未看到同等heartbeat。单次 rollout 加载、模型采样和写回若超过一小时，另一个进程可能回收其lease并重复抽取。

Owner-token CAS可以阻止旧worker覆盖新结果，却不能撤回旧worker已消耗的模型费用。Lease系统需要同时回答：

- 多久没有heartbeat才算死亡。
- 单次外部调用的最大deadline。
- 失去租约后如何取消在途模型请求。
- 重复计算是否有业务副作用。

## 6. 抽取前先完整加载 Rollout，再做提示预算裁剪

Phase 1先读取完整JSONL、过滤和序列化，再按有效context window的70%做head/tail截断；取不到窗口时fallback为150k tokens。

这控制了送给模型的prompt，却没有控制读取和序列化阶段的内存峰值。超大rollout仍可能在截断前占用大量内存。输入治理至少需要两层预算：

```text
storage read / parse bytes budget
  !=
model prompt token budget
```

只做第二层，不能抵御异常大文件。

## 7. Memory 过滤器主动区分用户历史与运行时噪声

抽取保留memory-relevant `ResponseItem`和部分inter-agent communication；明确丢弃：

- `SessionMeta`。
- `Compacted`。
- `TurnContext`。
- `WorldState`。
- 普通`EventMsg`。
- developer-role messages。
- 精确标记的 AGENTS 与 `<skill>`用户片段。

这体现了一个重要原则：Model history里“模型曾看见的内容”不等于“允许沉淀为用户长期记忆的内容”。系统指令、运行快照和工具控制事件应先按provenance过滤。

但过滤依赖已知item类型和精确标记；新外部上下文类型若忘记登记，可能穿透到Memory。因此过滤应优先采用来源标签 allowlist，而不是不断补字符串黑名单。

## 8. Prompt 输入与模型输出都做秘密脱敏

序列化rollout在发给模型前经过secret redaction；模型返回的`raw_memory`、`rollout_summary`、`rollout_slug`又被脱敏一次。

双向处理是值得学习的：输入脱敏避免把已知secret再次交给下游，输出脱敏防模型复述或重组敏感串。但正则/模式脱敏不代表匿名化，cwd、仓库名、绝对rollout path与自然语言身份仍可能泄露。

## 9. Phase 1 使用严格结构化输出，不把自然语言当提交协议

抽取结果schema禁止未知字段，并要求：

- `raw_memory`。
- `rollout_summary`。
- 可为null的`rollout_slug`。

空memory与空summary被记为`succeeded_no_output`，而不是解析成失败。这使“没有值得保留的事实”成为明确terminal outcome。

结构化输出解决的是结果形状，不证明内容真实。长期记忆还需要在Phase 2中去重、纠错和冲突消解，不能把第一次模型提炼直接提升为canonical user fact。

## 10. Stage 1 写回同时校验 owner 与 source revision

成功更新不仅要求lease owner一致，还绑定rollout的`source_updated_at`。Upsert拒绝旧来源覆盖更新后的来源，并尽量保留Phase 2已选择的baseline关系。

这里存在三种身份：

```text
thread_id          = 来源实体
owner_token        = 本次处理租约
source_updated_at  = 被处理的来源版本
```

只校验Thread ID会出现ABA：处理期间Thread增长，旧抽取却最后覆盖新投影。版本绑定是异步派生任务的基础。

## 11. Phase 1 的查询能力目前只覆盖 Legacy Rollout

候选明确筛选 legacy storage，full rollout loader也依赖完整JSONL。Paginated Thread即使有metadata，也不会进入相同抽取链。

这是能力缺口，不应在产品层把“Memory enabled”描述成所有Thread通用能力。稳定方案应通过ThreadStore的统一stream/read port消费canonical items，而不是让Memory直接依赖某一种物理格式。

## 12. Phase 2 是全局单所有者合并作业

Phase 2通过State DB全局job lease串行执行，lease同样为3600秒；成功后有6小时cooldown。它不是每个Thread单独更新一个文档，而是把多个Stage 1输出合并成一个共享Memory workspace。

全局串行能避免两个consolidator同时改`MEMORY.md`，代价是任何超慢或卡死合并都会阻塞全局新记忆。Heartbeat与owner fencing因此比单Thread任务更重要。

## 13. Stage 1候选按“使用反馈优先，时间次之”选择

Phase 2从当前输出中取top N，优先`usage_count`，再参考`last_usage`与`generated_at`，并排除超过最大未使用天数的输出。

这形成反馈环：

```text
模型引用某Thread记忆
  -> usage_count / last_usage更新
  -> 未来更容易进入Phase 2输入
  -> 更可能继续出现在summary
```

它比纯recency更贴近真实价值，但反馈质量完全依赖citation是否可信。若引用是模型自报且不核对实际读取证据，ranking会被幻觉或提示注入污染。

## 14. Filesystem Workspace 以 Git baseline 识别待合并变化

Phase 2把Memory root初始化为Git repository，随后：

1. 按稳定Thread ID顺序同步`raw_memories.md`。
2. 写每个rollout summary文件。
3. 删除不再入选的summary与过期extension resources。
4. 生成相对baseline的unified diff。
5. 只有存在diff时才启动consolidation Agent。

Git在这里不是协作发布工具，而是一个本地变更检测器。它能精确表达新增、修改和删除，避免每轮让模型重读所有历史。

## 15. Diff 有4 MiB上限，但Workspace同步仍缺统一写入事务

喂给Agent的`phase2_workspace_diff.md`最多4 MiB，限制模型输入爆炸。但原始文件同步使用普通filesystem写入；多个文件的更新、删除与diff生成不是一个原子事务。

进程在中间崩溃时，workspace可能处于半同步状态。Git能在下次显示“有变化”，却不能自动知道哪些文件属于同一批source snapshot。更稳设计需要manifest：

```text
generation
selected source revisions
expected artifact hashes
workspace sync status
```

## 16. Consolidation Agent 主动收缩高风险能力

内部Agent配置为ephemeral，并关闭：

- memories generate/use，避免递归。
- apps、MCP、plugins。
- collaboration与`SpawnCsv`。
- MemoryTool本身。

Approval设为Never。若父级是Managed permission profile，子Agent只能写Memory root且无network。

这体现“后台数据维护Agent不是普通交互Agent”：它只需读输入、编辑固定artifact，不应继承全套外部工具。

## 17. `Disabled` / `External` Profile 不会自动收缩成本地Sandbox

当父配置为Disabled或External时，Phase 2保留该profile，而不是一律转换为受限WorkspaceWrite。这意味着“关闭Codex sandbox”也会影响后台Memory Agent。

功能子任务应拥有自己的最小capability profile，不能只沿用父会话模式。尤其后台任务没有用户实时观察，默认权限应比前台更窄，而不是等宽。

## 18. Phase 2 用Heartbeat做长任务fencing

Agent运行期间每秒poll状态，并每90秒续租。Heartbeat失败或owner丢失会停止当前合并；在提交baseline前还会再确认一次所有权。

这是正确的提交屏障：即使任务曾经持有lease，也必须在改变共享baseline前证明“现在仍是owner”。一次启动时的授权不能无限延伸到最终commit。

## 19. 成功不仅看Agent结束，还验证Artifact不变量

Phase 2只有同时满足下列条件才成功：

- `MEMORY.md`存在且为普通文件。
- `memory_summary.md`存在。
- summary首行严格等于`v1`。

这把“Agent说完成”与“可消费artifact已形成”分开。版本首行提供最低限度reader compatibility gate。

仍缺少的验证包括总bytes、UTF-8/Markdown结构、引用路径有效性、重复事实、禁止内容、hash manifest与schema version迁移。

## 20. Baseline Reset 与 DB Success 不是原子提交

成功路径先删除临时diff并重置Git baseline，再把Phase 2 success、Stage 1 selection与watermark写入DB。若baseline已前移但DB提交失败，filesystem与SQLite会暂时分叉。

下次任务可能看到clean Git workspace并走no-change分支，从而间接修复选择状态，但这不是可证明的一次事务。跨SQLite与filesystem提交应使用可重放outbox/manifest：先写`prepared generation`，原子换artifact，再把generation标`committed`。

## 21. 失败的Agent修改不会自动回滚

若Agent已编辑文件，随后因invalid artifact、失租约或运行失败退出，当前workspace修改会保留；下一次Phase 2的diff会包含这些残留。

这有“保留有用进展”的好处，也可能让未验证内容混入下一轮输入。安全做法应在独立staging worktree运行，验证成功后原子promote；失败workspace可保留为诊断artifact，但不能成为下一次canonical起点。

## 22. Watermark 是账本，不是唯一Dirty Source

Phase 2会记录claimed/newest输入watermark，但是否需要启动Agent主要由Git diff决定。Watermark用于追踪处理进度，Git baseline用于观察artifact变化。

二者职责不同：

- source watermark：处理到了哪个输入版本。
- artifact baseline：输出内容是否变化。

不能用“输入时间更新”推断输出必然需要重写，也不能用“文件没diff”证明数据库selection已经提交。

## 23. Turn 读取路径先注入短Summary，再按需调用Dedicated Tools

Memory extension作为typed extension注册。Thread lifecycle根据`MemoryTool && use_memories`更新enabled状态；Context contributor读取`memory_summary.md`，trim后最多保留约2500 tokens，以developer instruction形式告诉模型如何继续读取。

开启dedicated tools时，还提供namespaced：

- list：最多2000项。
- search：最多200个match。
- read：默认最多20000 tokens。
- add ad-hoc note：显式新增一条临时长期笔记。

“短目录常驻 + 详细内容按需读”比每Turn注入完整Memory更节省上下文，也更容易记录实际使用。

## 24. Local Memory Backend 做了明确路径围栏

`resolve_scoped_path()`拒绝：

- `..`父目录。
- absolute/root/prefix path。
- 任意hidden component。
- 中间路径穿过非目录。
- 任意已存在路径组件是symlink。

List/search跳过hidden与symlink；read再次要求目标非symlink且为普通文件。Memory root只被加入additional readable root，不会因此扩大普通写权限。

这是比字符串`startsWith(root)`更可靠的分组件防护。不过它仍要面对TOCTOU：校验后读取前，另一个本地进程可替换路径；强对手模型需使用dirfd/openat类能力或受控filesystem service。

## 25. Search 会完整扫描并读取匹配范围，结果上限不是工作量上限

Search最终最多返回200条，但实现会先递归读取所有非隐藏UTF-8文件、计算所有match、排序，再按cursor切片。List上限2000也只限制返回数量。

因此`max_results`是响应预算，不是CPU/I/O预算。巨大Memory tree或超大文本仍可使一次search非常昂贵。应增加：

- 扫描文件数/总bytes/deadline。
- 单文件bytes与line上限。
- 命中达到阈值后的稳定early-stop策略。
- 可取消的索引查询。

## 26. Ad-hoc Note 使用`create_new`避免覆盖，但不保证完整持久化

文件名必须是`YYYY-MM-DDTHH-MM-SS-<slug>.md`，slug只允许小写ASCII、数字与连字符；总文件名、slug都有bytes上限。目录逐级拒绝symlink，最终文件用`create_new(true)`，并发同名只有一个成功。

优点是不会覆盖旧记忆。缺口是普通`write_all`后没有flush/fsync/rename提交；进程崩溃可能留下空文件或部分note，而该文件名随后因已存在不能重试。应先写私有temp、sync，再atomic rename，并返回artifact hash receipt。

## 27. Citation 同时承担UI投影与使用反馈

模型可以在最终答案里输出隐藏memory citation block。Core会：

1. 从用户可见文本中剥离隐藏markup。
2. 解析`path:line-line|note` entries与rollout/Thread IDs。
3. 去重ID。
4. 将citation投影为Turn metadata。
5. 对DB中存在的Thread ID增加`usage_count`并更新`last_usage`。

这使引用不污染正文，又能反馈哪些记忆有价值。解析器却没有验证path存在、line range有序且落在文件内，也没有证明模型本Turn真的调用过read/search。

## 28. 使用反馈应绑定“读取证据”，不能只信模型自报

当前只有合法Thread UUID且DB存在的来源会更新usage；无效ID不会新建记录。但模型仍可引用一个真实却未读取的Thread，从而抬高其rank。

更稳的反馈凭证应由Tool runtime签发：

```text
memory_read_receipt = {
  turnId,
  artifactGeneration,
  sourceThreadIds,
  path,
  byteOrLineRange,
  contentHash
}
```

Citation只能引用本Turn receipt覆盖的范围。这样“模型声明使用”才与“系统观察到读取”一致。

## 29. External-context Pollution 是写入资格，不是读取权限

若完成item是`ToolSearchCall/Output`或`WebSearchCall`，可把Thread memory mode标为polluted，后续不选为长期记忆来源。目的在于避免把外部搜索内容误当用户事实永久固化。

当前枚举偏窄：MCP、Apps、动态工具或其他external provider输出可能未被统一标记。更好的设计是每个Observation携带typed provenance：

```text
UserAuthored | WorkspaceObserved | ExternalFetched | ModelGenerated | SystemInjected
```

Memory policy按provenance组合判断，而不是追逐具体Tool variant。

## 30. Reset 横跨Filesystem与SQLite，无法一次原子完成

清理函数拒绝symlink root后，分别清空`memories`与`memories_extensions`内容并保留根目录；State DB的memory data又由独立transaction删除。

Filesystem先成功、DB失败，或反过来，都会形成可见的partial reset。Reset API应返回分阶段结果并可幂等重试；若产品承诺“已清除”，需要在恢复后继续补偿，而不是仅返回一次布尔成功。

## 31. 对当前 AI SEO Agent 最值得迁移的设计

当前阶段不应直接实现Codex完整长期Memory，更不需要先引入向量数据库。可以先迁移四个可验证边界：

1. 把`Message`事实与derived summary明确分表/分状态。
2. 异步summary job绑定`conversationId + source revision + owner lease`。
3. 使用结构化输出，并在服务端二次校验artifact schema。
4. 将用户可见citation绑定真实Tool observation或source record。

可用NestJS类比：

```text
Conversation / Message       -> canonical source
MemoryExtractionJob          -> Phase 1 leased worker
MemoryCandidate              -> typed derived facts
MemorySnapshot generation    -> Phase 2 committed artifact
MemoryReadReceipt            -> per AgentRun usage evidence
```

先做“可重建summary + 版本CAS”，比先做semantic search更能学到Agent系统真正困难的部分。

## 32. 不应照搬的实现细节

- 不把本地Git repository作为云端Memory数据库。
- 不让后台Agent继承交互Thread的全部工具与网络权限。
- 不把模型citation文本直接当计费、排序或审计事实。
- 不用绝对本地路径作为多租户云端artifact identity。
- 不把单进程startup task当可靠job scheduler。
- 不在当前Tool Calling阶段提前搭建长期Memory、遗忘策略和跨会话ranking全套系统。

## 33. 可验证的不变量清单

未来若实现最小Memory，可先写这些测试：

1. 同一source revision最多一个owner能提交抽取结果。
2. Source在抽取中更新时，旧worker提交被拒绝。
3. Lease过期worker不能提交最终snapshot。
4. Snapshot只有artifact校验通过后才切换current generation。
5. Artifact切换失败不会覆盖上一代可读snapshot。
6. Memory关闭时当前Conversation不会成为新来源。
7. External-fetched Observation不会沉淀为用户事实。
8. Read path不能逃出tenant/source scope。
9. Citation只引用本AgentRun真实读取过的source revision。
10. Reset可重试，最终同时清除artifact与索引。
11. Job重试不会重复扣业务额度或重复写外部副作用。
12. 任意失败都不影响canonical Conversation继续读取。

## 34. 最终结论

Codex Memories最值得学习的不是“用LLM总结历史”，而是它已经把长期记忆拆成了来源筛选、租约抽取、结构化候选、全局合并、artifact验证、按需读取、引用反馈和遗忘清理等不同责任。

当前实现的强项是source revision CAS、Phase 2 heartbeat fencing、能力收缩、Git diff增量输入、scoped read tools与citation反馈闭环；主要风险集中在Phase 1无heartbeat、读取前资源无界、跨SQLite/filesystem非原子、失败workspace残留、citation缺读取凭证、external provenance覆盖不全和reset partial commit。

对服务端Agent而言，正确的起点不是先选embedding model，而是先回答：哪份记录是canonical事实、谁能生成派生记忆、生成时绑定哪个source revision、哪一代artifact对读者可见、一次引用如何证明真实使用、删除如何得到可验证回执。
