# Phase 11 源码阅读：MCP、Skills、Plugins 与 Hooks

## 1. 阅读目标

这次源码阅读要回答的不是“Codex 支持多少扩展”，而是：

- 外部工具如何被收敛到核心 Tool contract？
- tool discovery、model visibility、local policy 与 execution 为什么分开？
- skill catalog metadata、正文读取、选择和注入为什么分开？
- plugin 如何组合能力与提供归因，而不是拥有另一套 runtime？
- hook 如何定义生命周期、匹配、并发、顺序和失败策略？
- 当前云端项目应该只复制哪些稳定边界？

本路线基于 `/Users/lihaoran/Desktop/codex@ab6a7eb87c`。Codex 扩展系统仍在演进，阅读时记录职责和不变量，并在笔记中注明快照。

当前快照先读 `codex-rs/ext/extension-api/src/registry.rs`、`codex-rs/ext/extension-api/src/contributors.rs` 与 `codex-rs/ext/extension-api/tests/registry.rs`。`ExtensionRegistryBuilder` 以 typed contributor 限制 thread/turn lifecycle、context/world state、MCP、tool、turn item、approval review 等贡献面，并保留注册顺序；这是理解 MCP/Skill/Plugin/Hook 如何汇入同一 host-controlled Runtime 的总入口。

## 2. 阅读前术语测验

先各用一句话定义 MCP、Skill、Hook、Plugin。如果定义中都出现“扩展 Agent 能力”，说明仍过于模糊。还应回答：

- 一个 MCP tool 是否天然可信？
- 一个 skill 能否授予工具权限？
- pre-tool hook 改写参数后，旧 approval 是否仍有效？
- 安装 plugin 是否等于启用它的全部 capability？
- catalog refresh 是否应影响正在运行的 Run？

带着这些问题阅读，避免被大量类型名带偏。

## 3. 路线 A：MCP 配置与运行时快照

### 3.1 源码入口

| 顺序 | 文件 | 阅读重点 |
| --- | --- | --- |
| 1 | `codex-rs/core/src/mcp.rs` | `McpManager` 如何合并 config、plugin/extension contribution 与 compatibility registration |
| 2 | `codex-rs/core/src/session/mcp_runtime.rs` | `McpRuntimeSnapshot` 如何给一次运行提供 manager 与可用 environment |
| 3 | `codex-rs/core/src/session/mcp.rs` | session 如何连接、刷新、读取 MCP 状态 |
| 4 | `codex-rs/config/src/mcp_types.rs` | 配置模型与 transport/auth 类型 |
| 5 | `codex-rs/config/src/mcp_requirements.rs` | 必需 server/能力的配置约束 |
| 6 | `codex-rs/core/src/session/mcp_tests.rs` | 初始化与状态测试 |

### 3.2 `McpManager` 要观察什么

本地快照中 `McpManager::runtime_config_for_step` 接收 config、thread init/store 和 available environment ids，再通过 extension contributors 产生有顺序的 Set/Remove/SelectedPlugin contributions。阅读时回答：

- 为什么 runtime config 不是直接等于静态配置文件？
- contributor action 为什么要有确定顺序？
- compatibility server、selected plugin registration 与普通 server 如何共存？
- plugin attribution 为什么要保留到 registration？
- step/turn 级 snapshot 与全局 manager 的职责如何分开？

### 3.3 云端映射

当前项目不需要复刻 overlay 系统，但应保留：

```text
tenant registrations + platform registrations
  -> deterministic resolution
  -> validated extension catalog
  -> per-Run frozen snapshot
```

一个 Run 的 snapshot 至少记录 server id、tool canonical name、schema/version hash、policy version 和 credential reference version。远端 refresh 只影响新 Run。

云端 PoC 还必须补上 Codex 本地信任边界没有替你解决的网络问题：真实 transport 只连平台登记 HTTPS，验证 TLS、DNS 结果、redirect 和目标 IP/port；拒绝 metadata/loopback/link-local/private/保留地址并防 DNS rebinding。stdio 若用于测试，只能从平台固定 executable/argv/env/cwd registration 启动。catalog/connection cache 必须按 tenant、registration、credential 与 policy version 隔离，不能把 URL/server name 当全局共享身份。

## 4. 路线 B：MCP Tool 如何进入核心 Tool path

### 4.1 源码入口

- `codex-rs/core/src/tools/handlers/mcp.rs`
- `codex-rs/core/src/mcp_tool_call.rs`
- `codex-rs/core/src/mcp_tool_call/telemetry.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/tools/src/mcp_tool.rs`

### 4.2 真实调用链

```text
MCP ToolInfo
  -> McpHandler::new
  -> create_tool_spec / canonical ToolName
  -> Core ToolRegistry
  -> ToolInvocation
  -> McpHandler::handle_call
  -> handle_mcp_tool_call(server_name, tool_name, call_id, args)
  -> MCP CallToolResult
  -> McpToolOutput
  -> core ToolOutput / Observation
```

### 4.3 需要记录的设计点

- `McpHandler` 实现核心 `ToolExecutor<ToolInvocation>`，说明 MCP 是一种 executor/source，不是平行 runtime。
- canonical tool name 有 namespace；hook tool name 还做兼容前缀处理。
- `ToolPayload` 必须是 function arguments，否则返回可给模型理解的分类错误。
- `call_id`、server name、tool name 和 wall time 被保留。
- `ToolInfo` 转 `ToolSpec` 时 schema/namespace 经过统一转换。
- pre/post tool hook payload 由 handler 提供安全、规范化视图。
- server read-only annotation 可以影响并行能力，但云端项目不能仅凭远端声明决定风险。

当前项目不要照抄 Codex 的具体本地 transport 信任假设：云端 HTTPS 有 SSRF/TLS/跨租户缓存风险，stdio 有任意进程启动风险，必须分别在 adapter registration boundary 收口。

### 4.4 配套测试

- `codex-rs/core/src/tools/handlers/mcp.rs` 内联 tests。
- `codex-rs/core/src/mcp_tool_call_tests.rs`。
- `codex-rs/app-server/tests/suite/v2/mcp_tool.rs`。
- `codex-rs/app-server/tests/suite/v2/mcp_server_status.rs`。
- `codex-rs/core/tests/suite/mcp_tool_exposure.rs`。
- `codex-rs/core/tests/suite/mcp_refresh_cleanup.rs`。

把测试按 discovery、exposure、execution、refresh、telemetry 五类整理，不要只抄一个 happy path。

## 5. 路线 C：Tool exposure 与搜索

### 5.1 源码入口

- `codex-rs/core/src/mcp_tool_exposure.rs`
- `codex-rs/core/src/mcp_tool_exposure_test.rs`
- `codex-rs/core/src/tools/handlers/mcp_search_tests.rs`
- `codex-rs/core/src/tools/spec_plan.rs`

### 5.2 本地源码事实

`build_mcp_tool_exposure` 区分 direct tools 与 deferred tools；当 search tool 开启时，不一定把所有 MCP tools 直接塞进模型请求。对于 Codex Apps tools，还会检查 connector 可用性和 `AppToolPolicyEvaluator`，并结合 destructive/open-world annotations。

学习重点：

- catalog 中存在不代表模型本轮可见。
- 模型可见不代表执行时一定允许。
- 大量工具需要 deferred/search 机制控制 context 成本。
- connector enablement、model visibility 与 policy 是多重过滤。
- 外部 annotation 是 policy input，不是 policy output。

当前项目第一版只有少量工具，不必立刻实现 tool search；但应该让 catalog、exposure snapshot 和 executor resolution 分开，以便未来真实工具规模出现时演进。

## 6. 路线 D：Skill catalog、authority 与按需读取

### 6.1 源码入口

| 文件 | 阅读重点 |
| --- | --- |
| `codex-rs/core/src/skills.rs` | core 对 skills service/injection/render 的整合与 implicit invocation telemetry |
| `codex-rs/ext/skills/src/catalog.rs` | `SkillSourceKind`、`SkillAuthority`、package/resource id、catalog entry |
| `codex-rs/ext/skills/src/selection.rs` | 显式 skill mention 收集 |
| `codex-rs/ext/skills/src/provider.rs` | provider routing 边界 |
| `codex-rs/ext/skills/src/tools/list.rs` | 列 catalog 的 tool contract |
| `codex-rs/ext/skills/src/tools/read.rs` | 按 authority 读取资源 |
| `codex-rs/ext/skills/src/render.rs` | catalog/instructions 如何进入 prompt |
| `codex-rs/core/tests/suite/skills.rs` | end-to-end 行为 |
| `codex-rs/app-server/tests/suite/v2/skills_list.rs` | app-server 列表 contract |

### 6.2 本地源码事实

`SkillCatalogEntry` 不只有 name/description，还包括：

- opaque package id。
- 拥有资源的 authority。
- main prompt resource id。
- display path/dependencies。
- enabled 与 prompt_visible 两个不同开关。

`SkillResourceId` 可以绑定 environment id/path，调用者不应从 opaque id 猜本地路径。这能帮助当前项目理解：resource owner/authority 决定读取方式，catalog consumer 不应自行拼接文件路径或 URL。

### 6.3 阅读问题

- 为什么 catalog metadata 可以常驻，而完整 skill 正文应按需读取？
- enabled 与 prompt visible 为什么不是同一状态？
- authority 如何阻止调用者用错误 transport 读取资源？
- 显式提及、隐式选择和实际读取分别在哪一层发生？
- skill dependency 缺失时是 warning、disabled 还是整个 Run 失败？
- skill 内容如何进入 context，而不伪装成用户历史？

### 6.4 当前项目映射

先设计：

```text
SeoSkillCatalog
  -> selected SkillRef
  -> SkillResourceReader by authority
  -> parsed instruction package
  -> ContextContributor with budget
```

第一版 authority 只有 `repository`，但类型与测试要证明路径遍历被拒绝、正文只在选中后读取、skill 无权直接调用工具。

## 7. 路线 E：Plugin 的组合与注入

### 7.1 源码入口

- `codex-rs/core/src/plugins/mod.rs`
- `codex-rs/core/src/plugins/injection.rs`
- `codex-rs/core/src/plugins/mentions.rs`
- `codex-rs/core/src/plugins/render.rs`
- `codex-rs/core/src/plugins/discoverable.rs`
- `codex-rs/core/tests/suite/plugins.rs`
- `codex-rs/app-server/src/request_processors/plugins.rs`
- `codex-rs/app-server/tests/suite/v2/plugin_list.rs`
- `codex-rs/utils/plugins/src/plugin_namespace.rs`

### 7.2 调用思路

`build_plugin_injections` 根据明确提及的 plugin，在已可见 MCP tools 和 enabled connectors 中计算该 plugin 真正可用的能力，再渲染成 `PluginInstructions`/context fragment。

必须观察：

- plugin 声明与当前实际可用 capability 取交集。
- instruction injection 是 context 行为，不是直接执行。
- plugin display name、id、namespace 和 capability attribution 各有作用。
- 显式 mention 决定何时注入，避免所有 plugin 永久进入 context。

当前项目只需做 manifest validation 与 composition fixture。不要从 Codex 的丰富 plugin surface 推导出“现在需要 marketplace”。

## 8. 路线 F：Hook 生命周期与失败语义

### 8.1 源码入口

| 文件 | 阅读重点 |
| --- | --- |
| `codex-rs/core/src/hook_runtime.rs` | core 在 session/tool/permission/compact/stop 节点如何调用 hooks |
| `codex-rs/hooks/src/events/` | 每类 typed request/outcome |
| `codex-rs/hooks/src/engine/dispatcher.rs` | matcher、并发执行、配置顺序恢复、summary |
| `codex-rs/hooks/src/engine/command_runner.rs` | timeout/进程执行边界，云端第一版不复制 |
| `codex-rs/hooks/src/types.rs` | legacy/general HookResult 的 success/fail-continue/fail-abort 语义 |
| `codex-rs/hooks/src/engine/mod_tests.rs` | dispatcher/handler 组合测试 |
| `codex-rs/core/tests/suite/hooks.rs` | Runtime 集成行为 |
| `codex-rs/app-server/tests/suite/v2/hooks_list.rs` | protocol list 行为 |

### 8.2 PreToolUse 真实语义

本地 `run_pre_tool_use_hooks` 构造包含 session/turn/subagent/tool use id/tool input 等字段的 request，发出 started/completed events，记录 additional contexts，并返回：

```text
Continue { updated_input?: Value }
Blocked(reason)
```

当前项目迁移时，特别验证：

- updated input 再次经过 schema validation。
- 资源与风险随新参数重新计算。
- 旧 approval 不能自动覆盖已改变的动作。
- blocking pre-hook 应在创建 ApprovalRequest 前完成；若存在 approval 后 rewrite 的兼容路径，旧 approval 必须按最终规范化参数/资源/策略 binding 失效并重新请求。
- blocked 是可分类 terminal tool outcome，不是 internal crash。

### 8.3 Dispatcher 的顺序与并发

`execute_handlers` 可以用 `FuturesUnordered` 并发执行 handlers，但最后按 configured order 整理结果，同时记录 completion order。这个细节提醒：

- 执行并发顺序和结果应用顺序是两个问题。
- 允许多个 hook 改写同一 payload 时必须定义合并规则；第一版应顺序执行 blocking pre hooks，避免歧义。
- 非阻塞 observability hook 可以并发，但仍需 timeout 和独立失败处理。

### 8.4 Hook scope

dispatcher 把 session/subagent start 视为 Thread scope，把 pre/post tool、permission、compact、prompt、stop 等视为 Turn scope。云端项目应同样给 hook event 明确 Run/Tool scope，避免全局 mutable state。

Codex hook 中的 additional context 也只能作为“需要由 runtime 处理的候选上下文”来学习，不能推导出 hook 可以直接 append 任意 system/history。当前项目应使用 typed `ContextContributionCandidate`，由安全投影和 ContextBuilder 依据 source/trust/scope/budget 决定是否在下一轮 sampling 注入；post hook 不改写已落定 ToolResult/Observation，run-finished hook 不再影响已完成 Run 的模型上下文。

## 9. 当前项目反向阅读

由于当前仓库还没有扩展代码，重点确认前置 contract 是否足以承载适配器：

| 当前/未来边界 | 要问的问题 |
| --- | --- |
| `AgentRuntimeService` | tool source 改变时，loop 是否仍只依赖核心 ToolDefinition/Executor？ |
| `AgentRuntimeEvent` | extension 细节是否默认保持内部，不强迫前端协议变化？ |
| ToolRegistry | built-in 与 MCP namespace/duplicate 行为是否确定？ |
| ToolPolicy | source/tenant/risk annotations 是否只是决策输入？ |
| ContextBuilder | skill/plugin injections 是否有独立 budget 与 provenance？ |
| RunRecorder | 是否记录 source/version/snapshot hash/hook summaries？ |
| Error taxonomy | transport/protocol/tool/hook/policy 错误是否分开？ |
| Phase 10 ActorContext | MCP credential 和 capability enablement 是否按 tenant 解析？ |
| MCP adapter/cache | HTTPS DNS/redirect/SSRF 是否 fail closed？cache/connection 是否含 tenant/credential/policy version？stdio 是否平台固定？ |
| Hook context | additional context 是否经 typed safe contribution 与下一轮 ContextBuilder，而非直接写 history？ |

如果这些边界尚未存在，先回到对应 Phase 补齐，而不是让 MCP adapter 持有 Prisma、LLM 和 stream mapper。

## 10. 推荐阅读节奏

### Session 1：MCP 从 discovery 到 ToolExecutor

1. `core/src/mcp.rs`。
2. `tools/handlers/mcp.rs`。
3. `mcp_tool_exposure.rs`。
4. 三组 MCP tests。
5. 画出当前项目 adapter 接入点。

### Session 2：Skill 是 catalog + authority + resource

1. `ext/skills/src/catalog.rs`。
2. list/read tools 与 selection。
3. render/injection。
4. skills integration tests。
5. 写一个最小 SEO skill package contract。

### Session 3：Plugin 只做组合与归因

1. plugin mentions/injection/render。
2. plugin tests。
3. 分析 capability 声明与实际可用集合的交集。
4. 写内部 manifest fixture，不写安装器。

### Session 4：Hook 的事件、结果与失败

1. `hook_runtime.rs` 的 pre/post tool 路线。
2. dispatcher matcher/order。
3. typed events 与 tests。
4. 设计当前项目的四个最小 event 和 failure table。

## 11. 第一遍可跳过

- Codex Apps 专属 connector UI 和产品 SKU。
- MCP elicitation 的完整交互。
- stdio 子进程的所有平台差异。
- hosted app/private extension 的内部实现。
- remote skill 下载与 marketplace。
- hook shell command runner 的平台细节。
- plugin 分发、缓存失效和 legacy compatibility 的全部分支。

但不能跳过 namespace、source attribution、policy intersection、timeout/cancel 和 failure semantics。

## 12. 阅读产物

- MCP discovery -> exposure -> core executor -> result 的调用链图。
- MCP/built-in tool contract 对照表。
- Skill catalog/authority/read/inject 数据流图。
- Plugin capability intersection 示例。
- Hook event/outcome/failure/ordering 决策表。
- Extension snapshot 字段草案。
- 外部 schema、annotation、prompt 和 hook output 的信任清单。
- 当前项目最小 PoC 文件职责图，但不是预先固定的文件清单。

## 13. Teach-back 问题

1. 为什么 MCP tool discovery 成功仍不能直接交给模型和 executor？
2. `McpHandler` 实现核心 ToolExecutor 对当前项目有什么启发？
3. direct tool 与 deferred tool 分离解决什么成本问题？
4. SkillAuthority 为什么比一个文件 path 更稳定？
5. skill enabled 与 prompt-visible 为什么要分开？
6. plugin injection 为什么取“声明能力”和“当前可用能力”的交集？
7. pre-tool hook 改写参数后为什么必须重新 approval/authorization？
8. hook 并发执行和按配置顺序应用结果有什么差别？
9. active Run 为什么应该冻结 extension snapshot？
10. 哪些 Codex 扩展实现明确不适合当前云端项目？
