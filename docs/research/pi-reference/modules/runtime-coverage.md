# Runtime / Session 研究覆盖清单

基线：`/Users/ayu/Learn/pi` HEAD `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`。说明正文见 [runtime-session.md](runtime-session.md)。

## 1. 核实强度

- **实现通读**：下表列出的两个包 `src` 内功能子模块，按完整函数和真实调用者读取；包含 old Agent、新 Harness、所有 durable drive 分支、3 种存储及共享测试 contract。
- **测试断言核对**：下文明确列出的关键场景读到 setup、触发和断言；其余测试已经列入功能目录，不声称每个测试文件逐行审计。
- **文档对照**：读取当前 roadmap 审计、harness 相关规范段，逐项反查源码；其余 work-package/mobile/plugin/pico 设计及历史交接资料按性质登记，不能作为现有实现证据。
- **未执行**：没有运行测试、benchmark、模型请求、shell 工具或数据迁移；本研究结论是静态代码行为证据，不是端到端测试通过证明。

`rg --files packages/agent/src packages/session-backends/sqlite-node/src` 得到 108 个文件，包含测试支持库；`rg --files packages/agent/test packages/session-backends/sqlite-node/test` 得到 66 个文件，包含测试 helper。数字是文件清单数量，**不是逐行测试审计或运行覆盖率**。

## 2. 功能子模块与源码范围

表中路径以 `/Users/ayu/Learn/pi/` 为根；入口链接可点击，其余同组文件按相对路径定位。除下文单独标识的测试、benchmark、历史资料外，表内文件均已按源码阅读。

| 功能子模块 | 实现文件 | 研究结果所在正文 |
| --- | --- | --- |
| 普通内存 Agent | [packages/agent/src/agent.ts](/Users/ayu/Learn/pi/packages/agent/src/agent.ts)、`agent-loop.ts`、`types.ts` | §1–2：双内核、内存循环、事件 settlement、工具顺序 |
| 包入口与模型流适配 | [packages/agent/src/index.ts](/Users/ayu/Learn/pi/packages/agent/src/index.ts)、`node.ts`、`stream-fn.ts`、`proxy.ts` | §1–2：注入 provider、Node 隔离入口、proxy 不是 durable server |
| Harness API / DTO | [harness/agent-harness.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/agent-harness.ts)、`types.ts`、`result.ts`、`config.ts`、`context.ts` | §3–4、§9：资源、配置、Result、context |
| Harness/Lane 生命周期 | [runtime/harness.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/harness.ts)、`runtime/lane.ts`、`runtime/types.ts`、`runtime/index.ts` | §3–4、§6：接纳、所有权、command 发布、关闭 |
| 恢复、观察与上下文 | [runtime/restore.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/restore.ts)、`runtime/transcript.ts`、`runtime/progress.ts`、`runtime/reducer.ts` | §4–7、§9：restore 无副作用、snapshot/rebase、pending prefix |
| 状态机分派与边界 | [runtime/drive.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive.ts)、`drive/checkpoint.ts`、`drive/boundary.ts` | §4：13 叶子、inbox、before_run_end 重检查 |
| 模型生成与恢复 | [drive/generation.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/generation.ts)、`response.ts`、`recovery.ts`、`deferred.ts`、`retry.ts` | §4.5、§6：intent、frame、settlement、retry/poll |
| 工具调度与终态 | [drive/tools.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/tools.ts)、`tool-placement.ts`、`reconcile.ts`、`terminal.ts` | §5–6：四状态、safe/never、source order、cleanup |
| durable 摘要/导航 | [drive/structural.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/runtime/drive/structural.ts) | §6–7：prepare、嵌套 usage、恢复 attempt、导航 commit |
| 一次 effect 执行边界 | [execution/effect-gate.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/execution/effect-gate.ts)、`assistant.ts`、`tools.ts` | §4–6：同步 admission、参数校验、stream 消费 |
| hooks/events | [harness/hooks.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/hooks.ts)、`events.ts` | §9：不同失败策略、buffered watch、handler 成本 |
| Session 契约、mutation line | [session/types.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/session/types.ts)、`values.ts`、`commit.ts`、`session.ts`、`mutation-line.ts`、`context.ts`、`index.ts` | §3–4、§8：树/current/pending/ledger、一次 commit |
| Memory 与共同 fork policy | [session/memory.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/session/memory.ts)、`in-memory-storage-state.ts`、`fork.ts`、`fork-policy.ts` | §8：全量物化、facade、fork 排除运行态 |
| JSONL | [session/jsonl/storage.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/session/jsonl/storage.ts)、`repo.ts`、`io.ts`、`codec.ts`、`fork.ts`、`legacy-v3.ts`、`types.ts`、`index.ts` | §8：transaction line、torn tail、按需升级、两遍 fork |
| compaction 算法 | [compaction/compaction.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/compaction/compaction.ts)、`branch-summarization.ts`、`utils.ts` | §7：cutpoint、retainedTail、摘要预算/格式/文件信息 |
| 工具资源 | [tools/read.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/tools/read.ts)、`write.ts`、`edit.ts`、`bash.ts`、`edit-diff.ts`、`file-mutation-queue.ts`、`path-utils.ts`、`image.ts`、`tool-context.ts`、`index.ts` | §5、§9：受限输出、编辑语义、默认 never、非 sandbox |
| Node 执行环境 | [env/nodejs.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/env/nodejs.ts) | §9：OS 能力、路径、child lifecycle、spill/backpressure |
| 输出与 usage helpers | [utils/output-capture.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/utils/output-capture.ts)、`adaptive-publisher.ts`、`shell-output.ts`、`truncate.ts`、`usage.ts` | §7、§9：源头限制、最新 view、UTF-8、兼容 collector |
| skills/templates/message 投影 | [harness/skills.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/skills.ts)、`prompt-templates.ts`、`system-prompt.ts`、`messages.ts` | §7、§9：按需资源、source provenance、provider 转换 |
| telemetry 声明 | [harness/telemetry.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/telemetry.ts) | §9–10：schema 与实际 instrumentation 分开 |
| 搜索接口 | [search/index.ts](/Users/ayu/Learn/pi/packages/agent/src/search/index.ts) | §10：只有接口 |
| backend Node 驱动 | [sqlite-node/src/index.ts](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/index.ts)、`sqlite/types.ts`、`sqlite/index.ts`、`sqlite/sql.ts` | §8：同步 transaction、参数化 SQL |
| SQLite 生命周期 | [sqlite/repo.ts](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/repo.ts)、`session.ts`、`storage.ts` | §8：宿主所有权、shared container、fork 不完整 |
| SQLite 数据访问 | [sqlite/session/entries.ts](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/session/entries.ts)、`branch-entries.ts`、`values.ts`、`usage-ledger.ts`、`session-row.ts`、`session-sequences.ts`、`session-stats.ts` | §8：实体、投影、序号、stats、branch index |
| SQLite schema | [migrations/001_initial.sql](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/src/sqlite/migrations/001_initial.sql)、`sqlite/migrations.ts` | §8、§10：PK/trigger、仅初始化迁移 |

### 测试支持库也属于设计的一部分

已阅读 [session/testing/index.ts](/Users/ayu/Learn/pi/packages/agent/src/harness/session/testing/index.ts) 导出的 `gating-storage.ts`、`instrumented-storage.ts`、`storage-decorator.ts`、`types.ts`、`conformance/storage.ts`、`conformance/session-repo.ts`、`benchmark/datasets.ts`、`benchmark/storage.ts`、`benchmark/session-repo.ts`。

- `GatingStorage` 可按 FIFO 停住 commit，显式 next 或 discard，构造存储先后顺序；`InstrumentedStorage` 只记录提交 attempt，不能当作提交已落地。
- 公共 conformance 用 Node assert 返回 runner-independent cases；各 backend 测试仅负责 fixture/注册。这很适合我们未来为 PostgreSQL backend 复用同一语义检查。
- `createSessionRepoStreamingForkConformance` 明确只为 Memory/JSONL 开启；SQLite 的 runner 只调用 `createSessionRepoConformance`。因此“SQLite conformance 通过”即使未来实测为真，也不能证明应用 list 的 tree fork 正确。
- benchmark 数据是确定的合成线性分支：1k/10k/100k entries、256-byte payload；catalog 为 100/1k/10k sessions。它不是生产数据分布，不能从 benchmark 框架存在推断真实性能。

证据：[streaming fork cases:702](/Users/ayu/Learn/pi/packages/agent/src/harness/session/testing/conformance/session-repo.ts:702)、[SQLite runner](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/test/repo-conformance.test.ts:1)。

## 3. 已读到断言的关键测试

以下均为**源码断言核对，未执行**。每条是一个明确机制的学习入口，不能由它外推为完整产品验证。

| 测试 | 实际断言证明的意图 |
| --- | --- |
| [accept.test.ts:133](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/accept.test.ts:133) | 两条输入只提交一次，准确 write families，接纳不解析 model |
| [accept.test.ts:551](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/accept.test.ts:551) | 并发接纳只有一个成功；另一方 LaneBusy |
| [accept.test.ts:564](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/accept.test.ts:564) | commit failure fault，内存不发布 operation |
| [accept.test.ts:596](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/accept.test.ts:596) | listeners 看到已发布状态，可重新串行读取；accept 等待 direct listeners |
| [drive-generation.test.ts:391](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-generation.test.ts:391) | provider 被调用时 durable state 已为 effect_pending；最终 entry/usage/tip/frame 删除同事务 |
| [drive-generation.test.ts:482](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-generation.test.ts:482) | 停住 frame 存储，provider live events 继续；释放后 frame 保序 |
| [drive-generation.test.ts:627](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-generation.test.ts:627) | 无帧孤儿请求不立刻调用 provider，合成 usage=0 error 后进入 attempt 2 retry wait |
| [drive-generation.test.ts:675](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-generation.test.ts:675) | 已提交 partial 正确恢复，不调 provider/after_response；预算耗尽落 failed |
| [drive-tools.test.ts:382](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-tools.test.ts:382) | B 先完成时 outcome_ready 已有而 Entry 不存在；A 完成后 transcript A→B |
| [drive-tools.test.ts:421](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-tools.test.ts:421) | safe 重放取持久 args/memo；unsafe executor 从未调用，保留 checkpoint 和 unknown outcome |
| [drive-public.test.ts:522](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-public.test.ts:522) | 提前取消的 observer 不安装 Drive；已运行中的 observer cancel 不取消 owner |
| [drive-public.test.ts:560](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-public.test.ts:560) | close 不等待不合作的 provider；观察者收到 HarnessClosed |
| [drive-public.test.ts:581](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-public.test.ts:581) | requestAbort 可先持久化再 drive reconcile，整个过程无需模型调用 |
| [watch.test.ts:550](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/watch.test.ts:550) | watch 先获得 mutation line→旧 snapshot + buffered event；publication 先→新 snapshot，无重复 |
| [drive-structural.test.ts:855](/Users/ayu/Learn/pi/packages/agent/test/harness/runtime/drive-structural.test.ts:855) | split-turn 摘要 2 次调用，各有 intent index/usage row，不伪造可见 assistant lifecycle |
| [jsonl-storage.test.ts:139](/Users/ayu/Learn/pi/packages/agent/test/harness/jsonl-storage.test.ts:139) | 无换行的 object/array transaction 全丢弃；完整坏行必须 reject 且不改源 |
| [SQLite storage.test.ts:94](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/test/storage.test.ts:94) | 一个普通 commit 只有一个数据库 write transaction |
| [SQLite repo.test.ts:815](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/test/repo.test.ts:815) | live source fork 抓一致只读 WAL 边界，later commit 能继续，第二次 fork 看到新状态 |
| [conformance/storage.ts:136](/Users/ayu/Learn/pi/packages/agent/src/harness/session/testing/conformance/storage.ts:136) | mixed atomicity、rollback、parent/ID、values/lists、分页、stats、close 的共享断言 |
| [conformance/session-repo.ts:142](/Users/ayu/Learn/pi/packages/agent/src/harness/session/testing/conformance/session-repo.ts:142) | branchless create、所有权、pending 拒绝、named fork、tree/application state、destination race |

## 4. 其余测试的功能索引

下列以测试文件名定位。已核对目录归属，未逐行审计全部断言；后续查阅时先打开实际文件，不能仅凭名字解释。

| 功能 | `packages/agent/test/` 下文件 |
| --- | --- |
| 普通 loop / Agent / proxy | `agent-loop.test.ts`、`agent.test.ts`、`proxy.test.ts`；`e2e.test.ts` 为真实环境相关，不在本次运行范围 |
| Harness 类型、输入输出 | `harness/types.test.ts`、`execution-assistant.test.ts`、`execution-tools.test.ts`、`execution-primitives.test.ts` |
| 主 runtime | `harness/runtime/harness.test.ts`、`lane.test.ts`、`restore.test.ts`、`accept.test.ts`、`drive-generation.test.ts`、`drive-tools.test.ts`、`drive-structural.test.ts`、`drive-reconcile.test.ts`、`drive-terminal.test.ts`、`drive-public.test.ts`、`drive-retry.test.ts`、`drive-retry-deferred.test.ts`、`progress.test.ts`、`watch.test.ts`、`reducer.test.ts` |
| Session/Branch/current values | `harness/branch.test.ts`、`session-create-branch.test.ts`、`storage-backed-session.test.ts`、`mutation-line.test.ts`、`values.test.ts`、`session-context.test.ts` |
| Memory | `harness/memory-storage.test.ts`、`memory-session-repo.test.ts`、`memory-conformance.test.ts` |
| JSONL | `harness/jsonl-io.test.ts`、`jsonl-storage.test.ts`、`jsonl-session-repo.test.ts`、`jsonl-storage-conformance.test.ts`、`jsonl-session-repo-conformance.test.ts`、`jsonl-v3-migration.test.ts`、`jsonl-v3-stream.test.ts` |
| 支持与观测 | `harness/gating-storage.test.ts`、`instrumented-storage.test.ts`、`context.test.ts`、`telemetry.test.ts` |
| 摘要/资源 | `harness/compaction.test.ts`、`branch-summarization.test.ts`、`skills.test.ts`、`prompt-templates.test.ts`、`system-prompt.test.ts`、`resource-formatting.test.ts` |
| OS 工具与输出 | `harness/tools.test.ts`、`nodejs-env.test.ts`、`text-line-reader.test.ts`、`truncate.test.ts`、`output-capture.test.ts`、`adaptive-publisher.test.ts` |
| 测试 helper | `harness/session-test-utils.ts`、`harness/runtime/test-utils.ts`、`utils/calculate.ts`、`utils/get-current-time.ts`、`utils/wait-for-tick.ts` |

SQLite 包的 6 个测试为 [adapter.test.ts](/Users/ayu/Learn/pi/packages/session-backends/sqlite-node/test/adapter.test.ts)、`sql.test.ts`、`storage.test.ts`、`repo.test.ts`、`storage-conformance.test.ts`、`repo-conformance.test.ts`。已核实 Node adapter 区分 create/existing/read-only、同步 transaction；核心 storage/repo 场景见上一节。

以后若做定向实测，应先依 Pi `AGENTS.md` 与本机 Node 环境规则准备，再在包目录运行**具体文件**，不得直接执行全部 vitest/e2e。本文未提供“已通过”结论。

## 5. 非运行源码的登记方式

| 资料 | 分类与本次处理 |
| --- | --- |
| `packages/agent/README.md`、`package.json`、vitest configs；SQLite README/package/config | 包边界与入口核对；实现结论回到 src，不依赖 README 示例推定 |
| `agent/docs/harness.md`、`runtime-simplification.md`、`post-wp05-roadmap.md`、`tool-durability.md`、`assistant-durability.md`、`values.md`、`telemetry.md` | 规范、历史交接与规划材料；正文记录已反查的关键差异，未声称逐行完成全部设计稿审计。`telemetry.md` 自述大多数 runtime span 未实现，是主文 §9 telemetry 结论的一手依据 |
| `agent/docs/work-packages/00–09` | 工作包历史/交接；HEAD 的 code 优先于旧状态表，WP08 必须按 backend 区分 |
| `agent/docs/mobile-handoff/**` | 设计和实验（delta/scopes/execenv/tool-output/assistant-output、facets/sandbox）；其中 `.ts/.js/.diff` 不当作已集成生产代码 |
| `agent/docs/pico/**`、`pico2.md`、`pico-v3.md`、`rpc.md`、`plugins.md` | 历史方案/协议和插件研究；与 protocol/client/server 的真正入口交叉读 |
| `docs/telemetry-schema.md` | 从 schema 生成的参考文档，不计作逐条运行验证 |
| `agent/scripts/generate-telemetry-docs.ts`、SQLite `scripts/copy-migrations.mjs` | 生成/打包脚本；后者已通读，仅复制 SQL 到 dist；前者按生成资料登记 |
| `agent/benchmark/**`、SQLite `benchmark/session/**` | timing/loaded-footprint/allocation harness；共享 workload 定义已读，未执行、不报告性能数字 |
| `CHANGELOG.md`、tsconfig、benchmark config | 历史/工具配置清单，不计入运行路径覆盖 |

## 6. 明确仍未证明的事情

1. **运行正确性**：所有研究依据静态源码与选定测试断言；没有获得本次测试通过输出。
2. **完整竞态矩阵**：已有 13 状态与大量 focused tests，但没有证明 harness 规范 Part 9 每个 close/reopen 状态与每个 race 的两种顺序都已覆盖；原仓审计也保留此任务。
3. **生产 durability**：未做 kill/restart、断电、磁盘满、COMMIT 结果丢失等真实故障注入；JSONL 的 rename 不能单独证明断电级 durable。
4. **多进程/多租户安全**：SQLite 明确由宿主负责单 writer；NodeExecutionEnv 没有云端 sandbox；未对用户环境执行这些能力。
5. **源码本身的未完成能力**：watchSession、search、迁移链、JSONL 回收、完整 telemetry、SQLite streaming/list fork 在正文标出；这是 Pi 现状，不是本研究要替 Pi 实现的功能。
6. **历史设计实验**：docs 下未集成实验未逐行安全审计、未运行。将来如果决定借鉴其中某个实现，需单独打开对应源码和测试，不能从本研究继承“安全/完成”结论。

学习研究可以收口为“已覆盖实际功能边界并记录已知缺口”，不能改写成“Pi 所有能力生产可用”或“每个历史文件、生成值与测试断言都逐行验证过”。

## 7. 本次文档自查

- 122 个不同 Markdown 文件/源码链接已检查路径存在及行号范围，核心锚点重新对到声明或对应语句。
- 两份新增文档分别运行 `git diff --no-index --check /dev/null <文件>`，无 whitespace 诊断；退出码 1 来自新增内容差异。
- Pi `git status --short` 为空，HEAD 仍为上述固定提交；只写本研究的两份 Markdown，没有修改 Pi 或提交 Git。
