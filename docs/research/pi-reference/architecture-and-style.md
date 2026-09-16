# Pi 的架构思想、目录组织与处理风格

## 结论

Pi 的产品选择是**保持小的默认能力面，用扩展适应用户工作流，让用户无需修改核心就能增加能力**。产品组合、执行机制、持久化事实、展示投影、Provider兼容的分层为这个选择提供支撑。它并非所有文件都短、所有实现都简单；新durable runtime与Chord已有明显复杂度。我们既要学运行边界，也要学它为何把一些功能留给宿主和扩展。

## 产品哲学：让工作流扩展出去

这部分首先指普通coding-agent的产品策略，依据是固定快照的 [README开头](/Users/ayu/Learn/pi/packages/coding-agent/README.md:15) 和 [Philosophy](/Users/ayu/Learn/pi/packages/coding-agent/README.md:495)，不把实验性durable/Chord的全部机制都当作最小起步要求。

| Pi 的选择 | 实际机制与理由 | 云端保留与改变 |
| --- | --- | --- |
| 默认只开放read/bash/edit/write | 通用文件/命令能力形成小的默认工具集合；其他工具由SDK配置、extensions和资源组合加入 | 先开放当前产品真正需要的受控工具；无需复制四个本机工具，也不一次堆满能力 |
| 不强制内置plan mode、todos、subagents、MCP | 计划和待办可以写文件；CLI工具、tmux或扩展表达不同工作流。它们的缺席是产品取舍，不自动等于实现缺口 | 保留工作流可配置性；只有具体需求才立项。云端任务的调度、权限和恢复由服务端承担，不能照搬本地tmux作为所有权机制 |
| 通过扩展而非fork核心来适配工作流 | TypeScript extensions提供工具、hooks和命令；skills/prompts/themes分别提供知识、文本模板与表现；Pi Packages组合并分发资源 | 先建立内部稳定扩展点和版本化契约；用户代码进入受控执行环境，不能由扩展绕过租户授权和审批 |
| Agent可以读取自己的文档来编写扩展 | system prompt按需提供自身README、docs、examples入口；用户提出Pi相关需求时，模型能先读契约，再生成扩展和执行验证 | 提供版本明确的工具/扩展文档与示例，让Agent生成可审查的扩展草稿；执行和发布仍受平台策略约束 |

最后一点是“自扩展”的具体落点。[system-prompt.ts:137](/Users/ayu/Learn/pi/packages/coding-agent/src/core/system-prompt.ts:137) 的原文节选：

```text
Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
```

这不是让模型持续自行改写核心。闭环是：用户提出能力需求 → 按需读取自身文档/示例 → 通过已有工具编写扩展 → 由宿主加载与验证。`evals` 还比较“给文档/不给文档”时编写扩展、provider、model配置的效果，把扩展接口是否容易使用纳入质量证据，见 [评估研究](./modules/model-telemetry-evals.md)。

Pi的“No permission popups”是本机产品选择，不代表云端可以没有授权。我们的可扩展工作流必须受平台的租户隔离、工具权限、执行配额与持久审批约束；这些约束不能因为模型生成了一个扩展就失效。

## 1. 全仓文件夹地图

目录相对 `/Users/ayu/Learn/pi`。完整 tracked 清单用 `git ls-tree -r 8a7b0c03dfb702663acafb6dc29f8acaa4ffe391` 生成；阅读证据见 [coverage](./coverage.md)。

| 路径 | 角色 | 优先级 / 阅读入口 |
| --- | --- | --- |
| `packages/ai` | 统一模型/消息/事件；providers、OAuth、catalog、cost、测试 faux provider | P0：[模型说明](./modules/model-telemetry-evals.md) |
| `packages/agent` | 旧 Agent loop；新的 harness、Session、operation drive、工具与 execution environment | P0：[runtime/session](./modules/runtime-session.md) |
| `packages/coding-agent` | CLI/SDK、AgentSession、resources/extensions、交互/RPC/print、实验宿主 | P0：[产品说明](./modules/coding-agent-tui.md) |
| `packages/session-backends/sqlite-node` | 新 Session 接口的独立 SQLite adapter 与 conformance | P0：同 runtime/session；用于学习存储契约，不建议我们换 SQLite |
| `packages/server` | 路由到 worker-owned Session、连接和 attachment 生命周期 | P1：[Chord/server/client](./modules/chord-server-client.md) |
| `packages/client` | 字节 transport、RPC correlation、服务 state hydration | P1：同上 |
| `packages/protocol` | v8 envelope + strict JSON + CBOR framing | P1：同上；具体 wire 算法见 [补充](./modules/wire-delta-coverage.md) |
| `packages/chord` | 独立 application composition、facets/services/state/delta/Context/loader | P1：同上；独立于 Pi 业务 |
| `packages/tui` | terminal renderer、editor/components、键盘、native platform glue | P2：产品说明；云端借状态组织，不移植终端细节 |
| `packages/telemetry` | vendor-neutral 观测契约与 conformance | P1：模型说明；不能当成所有请求已有 spans |
| `packages/evals` | eval 执行、结果、汇总与基线比较 | P1：模型说明 |
| `scripts/`、根配置、`.github/`、`.husky/` | 构建、边界检查、依赖/发布流程、研究统计 | P2：[工程工具](./modules/repository-tooling.md) |
| `.pi/` | 本仓开发时给 Pi 使用的扩展、skills 和 prompts | P2：开发工具；不是默认产品运行内核 |

P0/P1/P2 是本次云端学习优先级，**不是实现状态**。

## 2. 为什么要区分三套入口

| 入口 | 核心组合 | 当前定位 |
| --- | --- | --- |
| 普通 CLI / SDK | AgentSession + Agent + SessionManager + Models | 完整产品功能，旧 JSONL history |
| `PI_EXPERIMENTAL=1` 的 client/server | coordinator + server + worker + AgentHarness + Chord services | durable 和多 presentation 实验；有独立 Radius relay adapter |
| `experimental/mini` | 小型 RPC peer + session server + worker + lane + TUI reducer | 另一条缩小组合实验，不能视为上面主实验路径的薄封装 |

三个路径的“会话”“重连”“退出”实现不能混读。例如 mini 最后一个 presentation 离开会终止 worker；主 experimental WorkerLifecycle 还检查 active operation。图表以标题注明自己的范围。

## 3. 八个值得学习的做法

| 做法 | 真实证据 | 我们的取舍 |
| --- | --- | --- |
| 产品决定能力，核心提供机制 | coding-agent SDK 组装模型、工具、资源；普通 Agent 不理解 TUI | Runtime 继续不依赖 Vue、Admin 或 SEO Controller |
| 长期历史与当前执行分开 | 新 Session branch / op / journal；AgentHarness 的 lane/drive | Conversation 与 operation 分层，不能把 Message 当所有事实的容器 |
| 接纳和执行分开 | Lane.accept 原子落意图，drive 单独接管 | HTTP 可返回 accepted；worker 才拥有执行，但需新增协议而非改一个返回值 |
| 先记录副作用意图，再处理未知结果 | durable tool journal 的 `effect_pending` / `outcome_ready` / completed | 外部写调用要有 receipt/idempotency，不拿 retry 兜底所有失败 |
| 观察者不拥有执行 | lane.watch、attachment 与 operation cancel 分开 | 关页只解除订阅；显式取消单独命令 |
| 边界一次校验，内部用明确类型 | provider input 变换、工具参数、protocol + service adapter 的分层校验 | 保留当前 contracts/DTO；不把所有校验压到最外层 |
| 构建与激活分开 | Chord manifest/load 与 FacetHost activation/reload | 有真实插件需求再加；SHA 校验不是安全沙箱 |
| 用可控假环境验证故障 | faux model、Session backend conformance、断流/恢复 fixtures | 借故障注入场景，优先离线可重复测试 |

证据分别在四份模块说明中沿调用链列出，不能单凭本表当作实现规格。

## 4. 不值得照搬的部分

- **大型门面**：当前 AgentSession、interactive-mode、package-manager 都是数千行。职责可集中，但大小本身不是值得复制的风格；我们已有 `configuration/context/sampling/lifecycle/grounding` 分域应保留。
- **本机信任模型**：读取任意路径、spawn shell、运行扩展是本机产品选择。云端必须把租户/workspace/credential scope 作为输入，不能相信路径或随机 ID 就是授权。
- **宿主进程编排**：一个 Session 一个进程、Unix socket、coordinator 适合本地升级与分离 UI。我们先验证单 Node 服务 + PostgreSQL 的 owner 契约，隔离或容量要求明确后再拆 worker。
- **完整多 Provider 生态**：不为目录一致引入所有 adapters/OAuth。先保持 DeepSeek 与已立项的 wire API 能力，再按实际模型需求扩展。
- **CBOR / Delta / 新插件框架同时引入**：先把 durable facts 与恢复语义做好。序列化优化和动态组合要用真实带宽、CPU 或第二宿主需求证明价值。

## 5. 我的研究心得

阅读需要同时回答两个问题：“这项能力为何进入核心或留给扩展”，以及“谁在await前后仍拥有这件事”。前者解释Pi的产品风格，后者解释运行可靠性。工程深度藏在已接纳但等待者离开、输出已经产生但事实尚未提交、旧代结果晚到、工具做完却没记账这些窗口里。

目录结构服务这些边界：`ai` 处理 provider 差异；`agent` 处理执行和状态；`coding-agent` 处理产品资源；`server/client/protocol` 处理连接；`chord` 处理组合。对于我们，先把同样的问题分清，再决定需不需要相同目录或相同数量的包。
