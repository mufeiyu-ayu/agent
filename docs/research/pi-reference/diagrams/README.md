# Archify 图表索引

**[打开图集：index.html](./index.html)**，左侧菜单切换八张图；右上角可单独打开当前图。

固定源码版本与路径见 [source-snapshot](../source-snapshot.md)。图是阅读导航；事实解释以模块文档和源代码为准。01–05、07、08 画本机 Pi 的指定路径，06 是我们云端方向的候选设计。

| 图 | 用途 | 配套文档 / 源码入口 |
| --- | --- | --- |
| [01 全仓架构](./01-repository.html) · [JSON](./specs/01-repository.json) | 自上而下三层：产品外壳 → 两代运行内核与 Chord → 模型与存储；普通 CLI 走左列，durable 实验走右列 | [架构思想](../architecture-and-style.md)；SDK、AgentLoop、AgentHarness、Models、Chord |
| [02 Durable runtime](./02-durable-runtime.html) · [JSON](./specs/02-durable-runtime.json) | 自上而下主脊 Harness → Lane → Drive → Tools；Session 与 Watch 在左，Models 在右 | [runtime §3–6](../modules/runtime-session.md)；`runtime/harness.ts`、`lane.ts`、`drive.ts` |
| [03 一次 durable operation](./03-operation.html) · [JSON](./specs/03-operation.json) | 时序图（时间自上而下）：accept → drive → checkpoint → 采样 → 工具 → 回到 checkpoint → finish；每条消息标出持久化边界 | `drive/checkpoint.ts`、`generation.ts`、`response.ts`、`tools.ts`、`deferred.ts`、`terminal.ts` |
| [04 附着时序](./04-attachment.html) · [JSON](./specs/04-attachment.json) | handshake、路由、订阅快照安装、后续有序更新 | [Chord/server/client](../modules/chord-server-client.md)；`Client.subscribeService`、`SessionRouter.attachClient`、Transcript |
| [05 数据投影](./05-context-projections.html) · [JSON](./specs/05-context-projections.json) | 模型上下文、UI snapshot/events、durable恢复三种数据流 | runtime `transcript/session-context`；[模型变换](../modules/model-telemetry-evals.md)；Transcript provider |
| [06 云端候选架构](./06-cloud-direction.html) · [JSON](./specs/06-cloud-direction.json) | 自上而下：Web 发命令 → API 接纳 → Run Owner 执行 → PostgreSQL 事实 → 投影回 Web；模型与工具在右 | [current-agent-mapping](../current-agent-mapping.md)、[roadmap](../roadmap.md) |
| [07 普通 CLI 的一次 prompt](./07-classic-loop.html) · [JSON](./specs/07-classic-loop.json) | 时序图（时间自上而下）：用户 → AgentSession → Agent loop → Models 返回 toolCall 则执行工具再采样，返回文本则回复用户 → agent_end → agent_settled；R0（#115–117）实现时与当前项目最接近的参照 | [产品主链 §3](../modules/coding-agent-tui.md)、[运行内核 §2](../modules/runtime-session.md)；`agent-loop.ts`、`agent-session.ts` |
| [08 生命周期与可定制点](./08-lifecycle-hooks.html) · [JSON](./specs/08-lifecycle-hooks.json) | 两列自上而下按发生顺序：左列普通产品的扩展事件（session_start → before_agent_start → context → tool_call → agent_end → agent_settled），右列 durable harness 的 hooks（before_drive → before_run → transform_context → before_tool → before_run_end → before_compaction）；只画能改变行为的点 | [产品主链 §6.4](../modules/coding-agent-tui.md)、[运行内核 §9 hooks 表](../modules/runtime-session.md)；`extensions/types.ts`、`harness/hooks.ts` |

## 图中的折叠约定

- 01 是主要使用关系，完整 package 清单及旁路 telemetry/evals 在架构文档；不是每条 import 的依赖图。
- 02 的 Watch 归 Lane；`Harness.watchSession` 仍未实现。工具 effect 由 Drive 调度，Models 不直接调工具。
- 03 折叠了 13 个 durable 内部状态、摘要和 retry_wait 细节；`deferred` 来自模型后台响应，permit 只是显式 poll 额度，不是用户审批。无工具回复仍先回 checkpoint 复查，不能直接跳终态。参与者顺序 Lane / Session / Drive / Models / Tools 是为了让 Drive 与 Session 相邻，不表示调用层级。
- 04 折叠 server→worker 的控制面转发，不表示Client直连worker。共享Lane watch在worker初始化时建立；客户端只订阅已有Transcript复制状态，不为每个连接重新watch。基础Client不自动重发命令；Radius adapter的reconnect/reattach另见宿主文档。
- 05 是数据责任地图，三行不是一个全局事务。UI reducer 从 `Lane.watch` 的 snapshot/events 建立状态，需要 rebase 时再 resnapshot。
- 06 的 operation/journal/订阅恢复/审批是候选，当前并未实现这些完整能力；Run Owner 可以先留在 NestJS 进程中。
- 07 只画旧内核，且只画一次工具续轮；真实运行中“toolCall → 执行 → 再采样”可重复多次，steering 在每次采样前注入，followUp 只在内层循环退出后检查。`agent.continue()` 续跑画成虚线消息，表示可能发生而非必然。
- 08 每列只挑最能改变行为的节点：产品层还有 `project_trust / resources_discover / input / user_bash / before_provider_* / session_before_*` 等，harness 还有 `before_request / before_payload / after_response / before_navigation`，完整清单看模块文档。上下两行不是一一对应：产品层扩展事件跑在旧 `AgentSession` 上，harness hooks 跑在新 durable 内核上，两者并存。

## 查看与编辑

```text
diagrams/
├── index.html        图集入口：侧栏菜单 + 当前图表
├── build.mjs         统一构建与同步检查；也维护入口页面模板
├── build.test.mjs    删除、重命名与非生成HTML保护的回归检查
├── README.md         本索引
├── specs/            集中维护8份Archify源JSON
└── 01–08-*.html      8张正式图表，由源JSON生成
```

只编辑 `specs/*.json` 中的图表内容、标题和类型。`build.mjs` 按文件名排序读取这些JSON，生成每张图和index菜单；不用再维护一份菜单配置。每份JSON的 `meta.output` 必须是对应同名HTML文件名。入口页面的布局和交互改 `build.mjs` 中的模板，不手工改生成HTML。

```sh
cd /Users/ayu/Desktop/agent/docs/research/pi-reference/diagrams
node build.mjs
node build.mjs --check
node build.test.mjs
```

依赖本机Node ≥18和 `~/.agents/skills/archify`；含repository证据的图使用 `~/Learn/pi` 核验源码。构建逐图运行validate与deliver，通过后生成index，并清理失去源JSON的编号图表HTML。编号HTML文件名是生成物专用命名空间；其他HTML不会自动删除，而会提示手动处理。

`--check` 先核对HTML输出集合，拒绝任何无对应JSON的HTML；再在临时目录重建图表并逐字节比较，同时检查index是否与JSON和模板同步。失败会退出，不改正式文件。`build.test.mjs` 只操作临时副本，验证删除、重命名、只读检查和手写HTML保护。

浏览器直接打开本地index即可，使用原生iframe加载同目录图表，无需HTTP服务或fetch JSON。窄屏菜单可折叠；原图仍可单独打开。布局改动的截图、联系表和回执只在临时目录验收，不存入研究目录。

## 检查记录

8 组 JSON/HTML 全部通过 showcase 校验；统一构建同步检查与构建回归检查通过。本轮把 01/02/06/08 改为自上而下的紧凑网格、03/07 改为时序图并全部开启 trace 动画后，尚未在浏览器中做人工视觉检查。实际验证范围见 [verification.md](../verification.md)。
