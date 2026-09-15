# Pi 参考知识库：为云端 Agent 带读与重构准备

**主要读者是带用户学习源码的智能体。** 本目录研究 `/Users/ayu/Learn/pi`，提炼架构思想、目录组织、关键代码与处理风格，供用户完成当前 agent 源码学习后，以 Pi 为主要参照讨论云端方向。它是现行研究与后续学习入口。

研究准备完成 ≠ 用户已经学完 ≠ 重构已经批准。正式任务与状态仍以 [`docs/tasks/README.md`](../../tasks/README.md) 为准；当前 #115 → #116 → #117 不由本目录重新排期。

图表统一从 **[图集入口](./diagrams/index.html)** 打开，左侧菜单切换；源码JSON集中在 `diagrams/specs/`。

## 先读这五点

1. **版本固定**：Pi `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391`，agent 基线 `4e53bf681b9958ceac6991280cedbdad35612e80`；见 [源码快照](./source-snapshot.md)。不要把本文当上游最新版或当前安装的 Pi 行为。
2. **三条产品路径**：普通 CLI/SDK、主 experimental client/server、experimental mini 并存。默认 CLI 用旧 AgentSession/Agent，新 AgentHarness 的持久化能力不能自动归给默认 CLI。
3. **先理解产品选择，再读机制**：Pi用小的默认能力面与可扩展工作流减少修改核心的需要；自身文档/示例支持Agent按需编写扩展。云端保留这种组合方式，同时保留我们的授权、Context与Grounding边界，见 [架构与产品哲学](./architecture-and-style.md)。
4. **不要混淆能力**：历史 replay、操作 resume、重新执行 effect 不同；effect Gate/poll permit 不等于用户审批；state replication 不等于数据库日志。
5. **一次只带读一条链**：按用户问题选择模块、打开原代码、解释输入/输出/控制权和下一断点；详见 [带读说明](./how-to-read.md)。

## 目录结构

```text
pi-reference/
├── README.md                       目的、路由、目录与阅读顺序（本文件）
├── how-to-read.md                   给带读智能体的工作方法与提示示例
├── learning-method.md               子系统七步法与学习/实验的边界
├── source-snapshot.md               固定版本、证据规则、覆盖含义
├── source-files.txt                 全仓 1714 个 tracked 文件与 Git blob ID
├── architecture-and-style.md        11 个主要包、三条入口、架构心得与取舍
├── current-agent-mapping.md         我们当前代码事实、缺口、候选目录映射
├── roadmap.md                      学习顺序 + 分阶段云端重构方向
├── coverage.md                     全仓功能覆盖、阅读深度和范围边界
├── verification.md                 实际检查、图表验收、未执行范围
├── modules/
│   ├── coding-agent-tui.md          普通产品链、资源/扩展/工具、UI与mini
│   ├── runtime-session.md          两代运行内核、durable Session/Drive/恢复
│   ├── model-telemetry-evals.md     Provider、消息流、auth/catalog、观测与评估
│   ├── chord-server-client.md       Facets、RPC路由、状态复制与多端附着
│   ├── experimental-host.md        Coordinator、Server/Worker、Relay生命周期
│   ├── wire-delta-coverage.md       Delta/CBOR/Unix算法与边界
│   ├── repository-tooling.md        构建/依赖/测试/发布/维护工具与91文件索引
│   └── *-coverage.md              runtime/model/product 的分模块阅读证据
├── diagrams/
│   ├── index.html                 左侧菜单串联六张图的查看入口
│   ├── build.mjs                  从JSON生成图表与菜单，支持同步检查
│   ├── build.test.mjs             删除/重命名源JSON与文件保护的回归检查
│   ├── specs/                     六份源JSON集中维护
│   ├── README.md                  图表用途、源码锚点与维护方法
│   └── 01–06-*.html               六张正式图表（由JSON生成）
└── checks/
    ├── model-study-check.mjs        9组原生离线断言
    └── wire-study-check.mjs         Delta/CBOR/framing原生离线断言
```

图表内容和菜单标题统一从 `diagrams/specs/*.json` 维护，运行 `node diagrams/build.mjs` 重建六张图与index。截图、四图验收页和机器回执不存入研究目录。**智能体先读图表索引或JSON，避免把生成HTML全文载入上下文。**

## 按问题路由

| 用户要学什么 | 先读 | 原码第一站 |
| --- | --- | --- |
| Pi 整体怎样分层 | [架构与风格](./architecture-and-style.md)、[总图](./diagrams/01-repository.html) | `coding-agent/src/main.ts` 的 createRuntime |
| 一次输入怎样到模型 | [产品主链](./modules/coding-agent-tui.md) §2–3 | `core/sdk.ts → AgentSession.prompt → Agent.prompt` |
| Tool Call 怎样继续 | [运行内核](./modules/runtime-session.md) §2、§5 | `agent-loop.ts`；再对照新 `runtime/drive/tools.ts` |
| 流、partial、provider差异 | [模型边界](./modules/model-telemetry-evals.md) §2–5 | `ai/src/models.ts → api/lazy.ts → api/*` |
| 会话树与模型历史 | [运行内核](./modules/runtime-session.md) §3、§7–8 | `harness/session/context.ts`、`fork-policy.ts` |
| 中断恢复、未知工具结果 | [运行内核](./modules/runtime-session.md) §4–6、[operation图](./diagrams/03-operation.html) | `runtime/drive.ts → recovery.ts / tools.ts` |
| 关页继续、重连与多端 | [附着](./modules/chord-server-client.md)、[宿主](./modules/experimental-host.md) | `Server/SessionRouter → WorkerLifecycle → Lane.watch` |
| 插件、skills、目录组织 | [产品主链](./modules/coding-agent-tui.md) §6、[Chord](./modules/chord-server-client.md) §2 | `resource-loader → extensions/loader → runner` |
| 压缩、分支切换 | [运行内核](./modules/runtime-session.md) §7、产品 §5 | `prepareCompaction → structural driver → commit` |
| 成本、质量与测试方法 | [模型/评估](./modules/model-telemetry-evals.md) §7–9、[工程工具](./modules/repository-tooling.md) | `evals/summary.ts`、GatingStorage/conformance |
| 如何改我们的项目 | [当前对照](./current-agent-mapping.md) → [roadmap](./roadmap.md) | 当前 `agent-runtime/README.md` 与对应实现 |

## 已知差距不能藏在“已研究”后面

Pi 源码仍有 `watchSession`/search stub、SQLite streaming/list fork 不完整、JSONL 回收和 telemetry 未全接入等明确缺口；它的请求期 context/provider 变换也不自动满足我们的 `model-visible ⟺ logged`。这些是研究结论，详见对应模块，**不属于本次要替 Pi 实现的任务**。

本次覆盖全部主要包与工程功能域、为重要代码留摘录/注释/调用链及测试定位。生成目录值、媒体、fixtures 和历史实验按性质登记，没有声称全部历史文件、生成值和测试断言逐行安全审计。完整核实强度与未运行范围见 [coverage](./coverage.md) 和 [verification](./verification.md)。

## 与其他文档的关系

- 现行研究总入口：[`../README.md`](../README.md)。
- 现行学习方法：[learning-method.md](./learning-method.md)；阅读节奏与主题路由见本目录的how-to-read和roadmap。
- 当前正式状态：[`../../tasks/README.md`](../../tasks/README.md)；阶段路线：[`../../roadmap.md`](../../roadmap.md)；事实日志：[`../../work-log.md`](../../work-log.md)。

冲突时先核对当前代码、正式 Task/Issue 决策与本次用户目标，再解释研究快照为什么不同；不为了“像 Pi”反向改变已确认的不变量。
