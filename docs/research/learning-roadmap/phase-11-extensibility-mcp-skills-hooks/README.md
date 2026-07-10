# Phase 11：MCP、Skills 与 Hooks 扩展架构

## 阶段文件

- [README.md](./README.md)：扩展术语、信任边界、目标架构与最小 PoC。
- [source-reading.md](./source-reading.md)：MCP、Skills、Plugins、Hooks 的 Codex 源码阅读路线。
- [practice-and-acceptance.md](./practice-and-acceptance.md)：扩展 contract、故障注入、测试矩阵与验收证据。

## 1. 阶段定位

这一阶段学习“如何让稳定的 Agent Runtime 被外部能力扩展，同时不绕过原有 Tool Contract、安全、预算和审计边界”。它不是接入越多工具越好，也不是建设插件市场。

本阶段核心问题是：

> 当工具不再全部由当前仓库内置、指令不再全部写死在 prompt、生命周期节点允许扩展时，系统如何发现、选择、验证和执行扩展，并保证外部声明只是候选能力，最终执行仍受本地 policy 控制？

## 2. 四个术语先分清

| 概念 | 解决什么问题 | 载荷 | 是否直接执行副作用 | 当前项目最小实验 |
| --- | --- | --- | --- | --- |
| MCP | 外部系统如何暴露 tools/resources/prompts 与调用协议 | tool spec、resource、call/result | Tool 可能有副作用 | 一个受控只读 MCP server adapter |
| Skill | 如何提供可复用、按需加载的领域工作说明与资源 | instructions、references、scripts metadata | 指令本身不应拥有隐藏权限 | 一个 SEO 审计 skill package |
| Hook | 生命周期节点前后如何运行确定扩展逻辑 | typed event/request/outcome | 取决于 hook 能力 | 一个 in-process、只观测或阻断的 typed hook |
| Plugin | 如何把 skills、MCP server、app/配置等能力组合、版本化和分发 | manifest + capabilities | 由内部 capability 决定 | 只做 manifest/组合设计，不做 marketplace |

禁止把这些词混用：MCP server 不是 skill；skill 文档不是工具授权；hook 不是任意 middleware；plugin 也不是另一套 Agent Runtime。

## 3. 进入条件

实现前必须证明：

- 至少一个真实业务 read-only built-in tool（实际读取 tenant-scoped SEO 资源，不是硬编码返回值）和一个 deterministic fixture executor 已通过同一 ToolRegistry/Executor/Observation contract。fixture 用于故障注入，真实工具用于证明 contract 能承载业务；不为了凑数量先做第二个生产工具。
- Phase 05 的 risk/approval 和 Phase 10 的 tenant/tool authorization 可复用。
- Tool timeout、AbortSignal、错误分类、输出大小与脱敏已稳定。
- Phase 06 的 context budget 能限制扩展说明与结果占用。
- Phase 09 的 trace 能按 source/server/tool/hook/skill 关联，但不会记录敏感 payload。
- 外部扩展失败不会让 Run/Step 留在非终态。

如果 built-in tool path 尚不稳定，MCP 只会把内部缺口变成网络问题；此时只能做协议阅读与 fake adapter 测试。

## 4. 当前项目起点

当前项目还没有 MCP、skill、plugin 或 hook 代码，且阶段 5 明确暂不做它们。已有的可复用基础应是后续阶段形成的：

```text
ModelStreamEvent
  -> ToolRouter
  -> ToolRegistry
  -> ToolAuthorizationPolicy
  -> Approval
  -> ToolExecutor
  -> ToolResult / Observation
  -> ContextBuilder
  -> Run/Step recorder
```

扩展层必须接到这条链中，不能平行再造：

- `McpExecutor` 不可直接把远端结果写入模型。
- skill loader 不可直接修改数据库或调用外部 API。
- hook 不可绕过 canonical Run 状态机。
- plugin 不可用 manifest 自报“trusted”就获得权限。

## 5. 从 Codex 学到的分层

### 5.1 MCP 是外部工具来源，不是执行特权

Codex 的 `McpManager` 聚合配置与 extension contributions；`McpHandler` 把 MCP ToolInfo 转换成核心 `ToolSpec` 并实现统一 `ToolExecutor`。工具可见性还经过 exposure/policy 过滤。

迁移原则：

- discovery 得到的是候选 catalog，不是已授权 executor。
- 外部 schema 先 normalize 到项目自有 ToolDefinition。
- 远端 server/tool 名要做 namespace，防止与 built-in 冲突。
- MCP call 仍走 authorization、approval、timeout、cancel、quota、redaction 和 audit。
- server 声明的 `readOnlyHint`、`destructiveHint` 只能作为输入信号，不能降低系统风险评级。

### 5.2 Skill 是有来源与 authority 的按需上下文

Codex Skill catalog 区分 authority、package id、resource id、enabled、prompt visibility 和 dependencies；显式/隐式 invocation 与实际资源读取也分开。

迁移原则：

- catalog metadata 与完整 instructions 分开，避免所有 skill 永久占用 context。
- skill 有 source、version、tenant availability、owner/trust 和 prompt budget。
- 只有选中后才加载正文与必要引用。
- skill instructions 不能扩大 ToolPolicy；“请调用管理员工具”只是一段文本。
- 解析/渲染错误应局部失败，不破坏整次 Runtime。

### 5.3 Plugin 是能力组合与归因

Codex plugin injection 根据明确提及的 plugin，把可见 MCP servers、apps 与 skill prefix 渲染成开发者上下文。

迁移原则：

- plugin manifest 只声明组成和版本，不重复实现 tools/skills/hooks。
- capability 必须逐项启用和授权，安装不等于全部生效。
- Run/Step 记录 capability source/version，便于复现和撤回。
- 同名、依赖缺失、版本不兼容必须确定性失败。

### 5.4 Hook 是有稳定事件与失败策略的扩展点

Codex hook runtime 明确区分 session start、user prompt、pre/post tool、permission request、compact、stop、subagent start/stop 等事件；`PreToolUse` 可以继续、改写输入或阻断，HookResult 也区分 fail-continue 与 fail-abort。

迁移原则：

- 先定义事件和 outcome，再允许注册 handler。
- 每个 hook 明确 synchronous/async、blocking/non-blocking、timeout、order 和 failure policy。
- 修改 Tool input 必须重新 schema 校验、授权和风险评估。
- `post_tool_use` 不应改变已经发生的副作用事实。
- 第一版只允许代码内注册的 in-process hook；任意租户脚本/命令 hook 属于不可信代码执行，超出本阶段。

## 6. 目标架构

```text
Extension Catalog
  ├─ BuiltInToolSource
  ├─ McpToolSource
  ├─ SkillSource
  └─ PluginManifestSource

Turn preparation
  -> resolve tenant-enabled extension snapshot
  -> select skills / tool exposure
  -> freeze source + version + policy snapshot
  -> build bounded model context and ToolDefinitions

Tool call
  -> Core ToolRouter
  -> initial syntactic schema validation
  -> HookRuntime.preToolUse
  -> full validation + resource resolution + authorization + risk/quota
  -> Approval（只绑定最终规范化输入）
  -> pre-execution re-authorization + approval binding check
  -> BuiltInExecutor | McpExecutor
  -> normalize + redact ToolResult
  -> HookRuntime.postToolUse
  -> Observation / Step / Trace
```

关键不变量：同一次 Run 使用冻结的 extension snapshot。运行过程中 catalog refresh 不应让下一轮 sampling 突然看到不同工具，除非显式设计动态刷新并有测试。所有能够 rewrite ToolCall 的 blocking pre-hook 必须发生在 ApprovalRequest 创建之前；如果某个兼容路径只能在 approval 后 rewrite，旧 approval 立即失效，必须用新动作摘要/哈希重新走完整 validation、authorization、risk、quota 和 approval，绝不能沿用旧决定。

## 7. MCP 最小设计

### 7.1 建议类型

```ts
interface ExtensionSourceRef {
  kind: 'builtin' | 'mcp' | 'skill' | 'plugin'
  sourceId: string
  version: string
}

interface McpServerRegistration {
  id: string
  tenantId: string
  transport: 'stdio' | 'https'
  endpointRef: string
  credentialRef?: string
  enabled: boolean
  trustLevel: 'internal' | 'approved_external'
}

interface ExternalToolDescriptor {
  source: ExtensionSourceRef
  externalName: string
  normalizedDefinition: ToolDefinition
  serverAnnotations: Record<string, unknown>
}
```

真实字段以实现阶段 ADR 为准。`endpointRef/credentialRef` 应指向平台批准的安全配置，不把 URL token 注入模型。`endpointRef` 不是让模型或普通租户提交任意 URL 的通道。

### 7.2 Discovery 与 execution 分开

Discovery：

1. 加载 tenant-enabled server registration。
2. 建立受限连接并协商能力；真实网络 PoC 只允许平台登记的 HTTPS endpoint。
3. 拉取 tool catalog，限制数量、schema 大小和命名。
4. normalize/namespace，应用 allow/deny 和风险覆盖。
5. 缓存带 TTL/version 的 snapshot。

Execution：

1. 使用 Run 冻结 snapshot 找到 descriptor。
2. 核对当前 tenant server 状态和 policy。
3. 对原始输入做初始语法/schema 检查，再以不含凭证和未授权资源内容的 safe snapshot 执行所有 blocking pre hooks。
4. 对最终输入完整重跑 schema、resource、authorization、risk、quota。
5. 若需要 Approval，只为最终规范化动作创建并绑定 ApprovalRequest。
6. 执行前重新授权并核对 approval binding、紧急 revoke 与 credential/policy version。
7. 带 timeout/cancel/response limit 调用远端。
8. 把 transport/protocol/application error 分类。
9. normalize/redact/truncate 后返回核心 ToolResult。

### 7.3 Transport、SSRF 与缓存隔离

本阶段的真实 smoke 只走一个受控 HTTPS MCP endpoint：证书校验不可关闭，host/port 必须来自平台 allowlist；DNS 解析后拒绝 loopback、link-local、metadata、私网和保留地址（除非该地址在隔离测试环境被显式批准），每次 redirect 都重新校验 scheme/host/IP/port，并限制 redirect 次数、连接/读取超时、响应字节和并发。要防 DNS rebinding，连接使用的 resolved address 也必须经过检查，不能只对字符串 URL 做一次正则。

若开发测试选择 stdio，它只能是**平台固定** registration：绝对 executable 路径或受控包/hash、固定 argv、禁止 shell 拼接、最小环境变量和 cwd、资源/超时限制；tenant/model 不能提交 command、args、env 或 executable path。stdio fixture 不能作为公开云端外部连接能力。

Discovery/catalog/connection cache 至少按 `tenantId + registrationId + endpoint identity + credentialRef version + policy/enablement version` 隔离；snapshot 再记录 schema/version hash。禁止只用 URL、server name 或 tool name 作为全局 cache key。cache hit 后执行前仍要校验当前 tenant enablement、紧急 revoke、credential/policy version，防止 Tenant A 的 catalog/连接/认证状态被 Tenant B 复用。

### 7.4 名称与冲突

建议内部 canonical name 使用可逆 namespace，例如 `mcp:<serverId>:<toolName>`；模型可见名要符合 provider 限制，可用稳定编码。无论具体格式为何，都必须测试：

- 两个 server 同名 tool 不覆盖。
- MCP tool 不能冒充 built-in tool。
- rename/version upgrade 能审计并决定是否兼容旧 Run。
- 非法或过长名称被拒绝，而不是静默截断造成冲突。

## 8. Skill 最小设计

### 8.1 Skill package 边界

```text
SkillCatalogEntry
  id / name / description
  source / version / authority
  mainResource
  enabled / promptVisible
  dependencies
  estimatedPromptCost
```

Skill 正文与资源通过 `SkillResourceReader` 按 authority 读取。当前云端项目可以先用仓库内只读资源验证，不允许路径穿越，不从租户上传的 zip 直接执行脚本。

### 8.2 选择与注入

- 显式选择：用户明确指定 skill，最可控。
- 规则选择：输入满足明确 domain tag；必须可解释。
- 模型选择：只看到 catalog metadata，再通过受控 read skill tool 获取正文；放到更后面。

注入位置使用受控 `ContextContribution`，由 ContextBuilder 决定放入 developer/context 区域，而不是让 skill/hook 自行写消息或伪装成历史 user/system message。每个 contribution 必须带 source/version/trust/scope/contentHash/budgetCost 和安全投影；总 prompt budget 中为 skill 设独立上限，多个 skill 冲突时使用确定优先级并记录选择。instruction 文本可以影响任务策略，但不能改变 ActorContext、ToolPolicy 或系统级指令优先级。

### 8.3 SEO 练习 skill

建议只创建一个“技术 SEO 页面审计”skill：

- 主说明：分析顺序、输出结构、什么时候调用已存在只读工具。
- reference：评分规则或字段解释。
- 无脚本执行。
- 使用 fake page data 评估 skill on/off 的差异。

目标是证明 instruction packaging 和按需加载，不是增加新业务能力。

## 9. Hook 最小设计

### 9.1 事件最小集

```ts
type HookEvent =
  | { type: 'run_started'; run: SafeRunSnapshot }
  | { type: 'pre_tool_use'; call: SafeToolCallSnapshot }
  | { type: 'post_tool_use'; result: SafeToolResultSnapshot }
  | { type: 'run_finished'; run: SafeRunSnapshot }
```

第一版无需覆盖 Codex 全部 hook。优先用 `pre_tool_use` 证明阻断/改写和重新校验，用 `run_finished` 证明非阻塞审计或通知。

### 9.2 Outcome 与失败策略

```ts
type PreToolHookOutcome =
  | { decision: 'continue' }
  | { decision: 'rewrite'; arguments: unknown }
  | { decision: 'block'; code: string; message: string }
```

每个 handler metadata 明确：

- order。
- timeoutMs。
- failureMode：`continue` 或 `abort`。
- events。
- source/version。

rewrite 后必须完整重新执行 validation、resource resolution、authorization、risk/approval requirement 与 budget estimation。ApprovalRequest 只能在全部 blocking rewrite 完成后创建，并绑定 `tenantId/actorId/runId/callId/tool+version/normalizedArgumentsHash/resourceRef/policyVersion`；执行前验证 binding 和当前权限。不要允许 hook 直接调用 executor。

hook 产生的 additional context 也不能直接 append 到模型 history。它只能返回受限 `ContextContributionCandidate`，由安全投影去除 secret，由 ContextBuilder 按 event scope、trust 和 budget 决定是否仅在**下一轮 sampling**注入；`post_tool_use` 不能改写已经落定的 ToolResult/Observation，`run_finished` 不再触发当前 Run 的模型上下文注入。

## 10. Plugin 最小设计

本阶段只设计可验证 manifest：

```text
PluginManifest
  id / version / displayName
  skills[]
  mcpServers[]
  hooks[]
  compatibility
  provenance / signature metadata
```

允许的练习是把一个 SEO skill 与一个 read-only MCP server registration 组合成内部 plugin fixture，验证：

- manifest parse/validate。
- capability 按租户逐项启用。
- source attribution 进入 Run snapshot。
- 卸载后新 Run 不再使用，旧 Run 仍可复盘。

不做安装器、远程 marketplace、自动更新、任意代码执行和第三方签名基础设施。

## 11. 任务拆分

### Task 11.1：Extension taxonomy 与 snapshot

- 定义 source/version/trust/tenant enablement。
- 设计一次 Run 的 frozen extension snapshot。
- 证明 catalog refresh 不改变 active Run。

### Task 11.2：MCP adapter PoC

- 只接一个平台登记、受控 HTTPS 的 read-only server；stdio 仅允许平台固定 fixture，不接受 tenant/model command。
- discovery -> normalize -> expose -> execute -> observation 完整走核心 tool path。
- 覆盖 auth、TLS/SSRF/redirect、跨租户 cache/connection 隔离、timeout、abort、oversized output、unknown tool 和 schema 冲突。

### Task 11.3：Skill package PoC

- 建立 catalog metadata 与 resource reader。
- 只在明确选择时读取正文。
- 记录 source/version/budget 和实际注入内容 hash。
- 用 eval 比较 skill on/off，不以“prompt 更长”视为更好。

### Task 11.4：Typed hook PoC

- code-owned handlers，固定事件。
- pre hook 的 continue/rewrite/block。
- blocking pre hook 在 approval 前完成；任何 approval 后 rewrite 都使旧 approval 失效并重新请求。
- post/finish hook 的 timeout 和 fail-continue。
- 每次 hook 产生 Step/trace summary，不保存 raw secret。
- additional context 只返回 typed candidate，并经过安全投影、scope/trust 与 ContextBuilder budget 后用于下一轮 sampling。

### Task 11.5：Plugin composition 设计

- manifest fixture 与 validation。
- capability reference resolution。
- tenant enablement + policy intersection。
- 不建设分发系统。

## 12. Red-Green-Refactor 总路线

### Red

- 外部同名工具覆盖 built-in。
- MCP descriptor 自称 read-only 后绕过 Approval。
- 任意 MCP URL 命中 metadata/私网或跨租户复用 catalog/credential cache。
- server 返回超大/恶意 schema 或结果。
- skill 全量注入导致 context budget 溢出。
- hook 改写参数后不重新授权。
- hook 在 approval 后改写参数却复用旧 approval，或把 additional context 伪装成 system/history message。
- active Run 在 catalog refresh 后工具集合漂移。

### Green

- namespace + normalize + local risk override。
- HTTPS allowlist + DNS/redirect SSRF 防护 + tenant-scoped cache；stdio 仅平台固定。
- 所有 MCP call 走核心 ToolPolicy/Executor contract。
- skill catalog/read 分离并纳入 context budget。
- typed hook outcome + timeout + explicit failure mode。
- pre-hook rewrite 在 approval 前完成；approval binding 与 typed bounded context contribution。
- frozen extension snapshot + source/version audit。

### Refactor

- built-in 与 MCP 出现真实重复后抽象 `ToolSource`，不提前做万能扩展框架。
- 只有两个 skill authority 后再泛化 provider routing。
- 只有多个 hook event 重复编排时再提 HookRuntime service。

## 13. 明确非目标

- 不允许租户上传/执行任意 JS、shell 或容器代码。
- 不建设公开插件市场、评分、付费或自动更新。
- 不一次接入多个 MCP transport/provider。
- 不接受 tenant/model 提交的任意 MCP URL、stdio command/argv/env；不允许跨租户共享带认证/策略语义的 discovery/connection cache。
- 不信任远端 tool annotations 作为最终风险结论。
- 不让 hook 越过 ToolPolicy、Quota 或 Run recorder。
- 不把 skill 当 RAG/向量库替代品。
- 不让 plugin 安装自动获得所有租户权限。
- 不在本阶段引入 Multi-agent；下一阶段只使用已稳定的扩展快照。

## 14. 退出标准

- built-in tool 与 MCP tool 使用同一核心 ToolCall/Result/Observation/Policy contract。
- 一个真实业务 read-only built-in tool 与 deterministic fixture 已先证明核心 contract。
- 一个受控 MCP tool 完成 discovery、调用、取消、失败和结果截断自动化测试。
- 真实 MCP smoke 通过 HTTPS/TLS/SSRF/redirect gate；stdio（若有）为平台固定，catalog/connection cache 有 tenant/credential/policy 隔离证据。
- 外部 schema/name/annotations 不能覆盖 built-in 或降低本地风险。
- 一个 skill 被按需读取、受预算限制、可记录 source/version，且 on/off eval 可比较。
- 一个 pre-tool hook 能 continue/rewrite/block；rewrite 在 approval 前完成并全量重验，旧 approval 对任何被改写动作均不可复用。
- hook/skill additional context 只能经 typed contribution + 安全投影 + ContextBuilder budget 进入下一轮 sampling，不能伪造 system/history 或改写已发生事实。
- hook timeout/fail-continue/fail-abort 有确定状态和测试。
- frozen extension snapshot 可复盘，catalog refresh 不污染 active Run。
- plugin manifest 仅组合能力，未形成第二套 runtime。

## 15. 阶段交付物

- MCP/Skill/Hook/Plugin 术语与边界 ADR。
- ExtensionSource、Catalog 与 Run snapshot 设计。
- MCP adapter PoC 和 contract tests。
- SEO audit skill fixture 与 eval 对比。
- Typed hook PoC 与 failure matrix。
- 内部 plugin manifest fixture。
- 信任、版本、禁用、撤回和审计说明。

## 16. 最终判断

本阶段完成的标志不是“页面上能列出 MCP 工具”，而是：

> 外部能力进入系统后会被转换为项目自己的受控 contract；无论来源是 built-in、MCP、skill、hook 还是 plugin，都不能扩大 ActorContext 权限、绕过 ToolPolicy 或破坏 Run 的可恢复和可审计性。
