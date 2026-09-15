# 全仓研究覆盖

## 范围与计数

固定 checkout 有 **1714 个 Git tracked 文件**，来自 `git ls-tree -r 8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`，原始清单保存在 [source-files.txt](./source-files.txt)。共 11 个主要功能包（SQLite 是 session-backends 下的嵌套包）以及根级工程资源。

文件数量用于交叉查漏，不能代表语义理解、测试覆盖率或逐行审核完成率。

| 功能域 | tracked 数量（含测试/文档/资源） | 阅读证据与结果 |
| --- | ---: | --- |
| agent | 230 | [runtime/session](./modules/runtime-session.md)、[runtime coverage](./modules/runtime-coverage.md)：old Agent、13状态Drive、Session/Mutation、3 backend、工具/env、compaction、watch、hooks |
| ai | 347 | [model](./modules/model-telemetry-evals.md)、[model coverage](./modules/model-coverage.md)：10种wire API与图片入口、40个provider factory分类、auth/catalog、事件/frame、成本/错误 |
| coding-agent | 762 | [产品](./modules/coding-agent-tui.md)、[product coverage](./modules/product-coverage.md)、[宿主](./modules/experimental-host.md)：普通与实验入口、资源/扩展/工具、model装配、各I/O mode、进程生命周期 |
| tui | 113 | 产品说明与 product coverage：两套renderer、输入/布局/组件、terminal/native平台适配 |
| chord | 39 | [Chord/server/client](./modules/chord-server-client.md)、[wire/delta](./modules/wire-delta-coverage.md)：facets/依赖/换代、provider/consumer/state、delta、Context、Node bundle |
| client | 19 | 同上：连接状态、request correlation、snapshot/update、Unix transport |
| protocol | 17 | 同上：strict envelope、CBOR/framing、非法数据与限制 |
| server | 29 | 同上与宿主：handshake、SessionRouter、多个attachment、释放/关闭、Unix listener |
| session-backends | 33 | runtime coverage：SQLite adapter/schema/事务/entries/values/ledger/fork/conformance |
| telemetry | 12 | model coverage：契约、Noop/内存、typed schema、conformance、未全接入的区别 |
| evals | 22 | model coverage：会话harness、五类eval、artifact、paired comparisons |
| 根级工程与开发资源 | 91 | [repository-tooling](./modules/repository-tooling.md)：完整91文件索引，workspace/构建/依赖/发布/测试/.github/.pi |
| **合计** | **1714** | 每一功能域均有研究入口 |

## 核实强度

| 层次 | 本次做了什么 | 不能推出什么 |
| --- | --- | --- |
| 核心实现 | 实际函数、调用方、状态转换、异常和清理，重点路径有短原文与标注 | 不能据此宣称全部并发竞态已实测 |
| 周边功能 | 各子目录职责、入口、代表实现与消费者；见模块coverage | 不把目录清单冒充每个helper逐行安全审计 |
| 测试源码 | 关键用例读到触发和断言，其余按场景/文件索引登记 | 阅读断言不是测试通过 |
| 离线断言 | 执行保存的 model/wire study checks，直接调用当前源码 | 仅证明列出的断言，不代替原仓全suite |
| 图表 | 保留6组正式JSON/HTML；校验、首次浏览器测量与视觉检查结果记录在verification，临时附件已清理 | 图的美观/绿色校验不能证明架构结论正确；另外交叉核对调用事实 |
| 文档与历史材料 | 核对设计/README与实现差异，标识proposal与未完成能力 | 历史work-package或mobile示例不等于当前产品路径 |
| 生成/媒体/fixtures | 记录来源、生成入口、消费者及性质 | 不逐行讲解重复数据、不宣称二进制或每条fixture被审计 |

## root 负责部分的具体阅读闭环

- **Chord composition**：`api/types → FacetKernel.activate/reload/terminate → ServiceSlot/InstanceDirectory → RemoteServiceProvider/RemoteServiceBinding → replicated state / wire codec → Node bundle/load`。
- **协议与服务**：`Client.request/subscribe → Connection → protocol framing/CBOR/strict envelope → Server.handleRequest → SessionRouter → RoutedSessionAttachment → endpoint`，含取消、断线与pending释放。
- **实验宿主**：`client-runtime → activateServer/startServer → CoordinatorConnection → SessionWorkerManager → session-worker → AgentController/Transcript → Lane`；另读 Radius auth/multiplex/reconnect 和 mini 的不同生命周期。
- **当前项目对照**：runtime README、policy、采样决策、实际主编排、ModelContext、LLM client、HTTP close/drain、Prisma Run/Step/Message、任务看板。

具体 Delta/CBOR/Unix、产品/native、模型/provider、runtime/backend 的逐功能记录由对应 `modules/*coverage.md` 补齐。

## 研究中发现并保留的限制

1. **默认入口与实验入口不一致**，包含 source condition、发布排除项及 Unix/Windows 开发启动差异。
2. **恢复能力不能按名称推断**：旧 JSONL ≠ 新 durable journal；`op.state` current value ≠ 不可变完整事件史；reconstruct ≠ execute。
3. **源码自身有未完成处**：Session-wide watch/search、SQLite tree list fork/streaming fork、JSONL回收、完整telemetry等，均在模块正文给实现证据。
4. **本机 model data 未 hydrate、无 Pi node_modules**：不运行真实 Provider/full suite/build；保留原生离线检查与缺失数据的实际结果。
5. **云端安全与分布式运行是新约束**：文件锁、随机route ID、project trust、Node VM加载都不能替代租户授权与执行隔离。

因此本次研究的交付结论是：全仓功能与重要机制已整理成可带读、可回查的知识库；它不是一份“Pi所有功能生产可用”或“所有历史材料逐行审计”的认证。
