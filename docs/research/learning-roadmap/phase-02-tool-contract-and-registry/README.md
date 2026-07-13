# Phase 02：Tool Contract 与 Registry

> 模块分类：**Core**。当前项目近期需要最小内置工具 contract；MCP、动态发现和插件化不在本模块实施范围。

## 1. 阶段问题

Phase 01 已让 runtime 看见完整的 model-side tool call candidate，但系统仍不知道：工具是否存在、参数是否合法、谁有权执行、输出如何回给模型。

本阶段只解决“工具作为后端能力如何被定义、注册、查找和直接执行”：**先把工具变成确定性的 application capability，再在 Phase 03 让模型驱动它。**

## 2. 学习目标

1. 区分 ToolDefinition、ModelToolSpec、UnvalidatedToolCallEnvelope、ValidatedToolInvocation、ToolExecutor、ToolResult 和 ToolRegistry。
2. 理解模型只能“提出调用”，系统 registry 才拥有工具存在性与执行权的最终解释。
3. 用运行时验证保护 TypeScript 静态类型边界。
4. 让 registry 对重复名称、未知名称和注册顺序具有确定行为。
5. 实现一个无网络、无副作用、可重复的只读 SEO 工具。
6. 保证 tool output 面向模型，UI message 与 durable step 仍是不同投影。
7. 为 Phase 03 准备“unvalidated envelope -> validated invocation -> execute -> ToolResult”的闭环组件，但本阶段不循环调用模型。

## 3. 前置条件

- Phase 00 测试基座完成。
- Phase 01 已能产出包含 `providerCallId/name/argumentsJson` 的完整 model event。
- 熟悉 TypeScript generics、discriminated union 和 NestJS module/provider。
- 当前只允许低风险、无外部副作用工具。

## 4. 概念与职责

| 概念 | 谁产生 | 谁消费 | 关键职责 |
| --- | --- | --- | --- |
| `ToolDefinition` | 应用代码 | registry/model request mapper | 名称、描述、输入 schema、风险 metadata |
| `ModelToolSpec` | definition mapper | provider adapter | provider-neutral 模型可见工具说明 |
| `ModelToolCallCandidate` | provider adapter | sampling reducer/router intake | provider call id/name/raw args/index；不知道 Run 的 samplingAttemptId |
| `UnvalidatedToolCallEnvelope` | sampling reducer/router intake | tool router/validator | candidate + server-owned sampling attempt；仍是不可信输入 |
| `ValidatedToolInvocation<T>` | router/validator | executor | 已查 registry、已解析、已按对应版本 schema 验证的内部调用 |
| `ToolExecutor<TIn,TOut>` | tool module | registry/runtime | 业务执行，不信任模型身份字段 |
| `ToolResult<T>` | executor boundary | runtime/context | 成功或结构化失败 observation |
| `ToolRegistry` | module composition | router/runtime | 唯一名称、查找、模型可见 definitions |

不要用一个包含所有可选字段的巨型 `Tool` interface 混合以上职责。

## 5. 设计

### 5.1 名称与版本规则

第一版工具名建议使用稳定 snake_case，例如 `analyze_url_structure`。名称一旦进入 prompt、测试和历史记录，就近似协议字段：

- 禁止空字符串和前后空格。
- 大小写敏感，统一小写 snake_case。
- registry 重复注册必须启动失败，而不是后者覆盖前者。
- 重命名属于兼容性变化；若历史恢复依赖旧名，需要 alias/version 策略。
- description 面向模型，应写“何时用、返回什么”，而不是营销文案。

### 5.2 最小 ToolDefinition

```ts
interface ToolDefinition {
  name: string
  version: string
  description: string
  inputSchema: JsonObjectSchema
  timeoutMs: number
  requiresApproval: boolean
  idempotent: boolean
  risk: {
    level: 'low' | 'medium' | 'high'
    sideEffect: 'none' | 'external_write'
    network: boolean
  }
}
```

本阶段所有可执行工具必须满足 `low + none + network=false + requiresApproval=false`；`timeoutMs` 必须是 server-owned 正整数，Phase 04 才真正执行 deadline；纯解析工具可声明 `idempotent=true`，但本阶段不据此自动重试。`version` 是 observation、step 和恢复时解释 schema/实现的依据，不等同于 npm 包版本。Risk metadata 暂时只作为 fail-closed gate；完整审批在 Phase 05。

### 5.3 静态类型与运行时验证

模型给的是 JSON 字符串，TypeScript generic 不会在运行时保护它。最小 parse pipeline：

```text
rawArgumentsJson
  -> JSON.parse
  -> unknown
  -> tool-specific parse/validate
  -> typed ValidatedToolInvocation.input
```

当前仓库没有通用 JSON Schema validator。第一只工具字段少时，可让 definition 附带 `parseInput(unknown)` 或独立 parser，并用同一组字段测试 schema/validator 一致性。不要为了一个 `{ url: string }` 立即引入重型 schema 平台；第二、第三个复杂工具出现时再评估 Ajv/TypeBox/Zod-to-schema 等方案。

无论选择哪种实现，都必须证明：

- 缺必填字段失败。
- 类型错误失败。
- 额外字段按 schema 策略处理；推荐第一版拒绝。
- JSON syntax error 与 schema validation error 可区分。
- 错误不会进入 executor。

### 5.4 未验证信封与已验证调用

```ts
interface UnvalidatedToolCallEnvelope {
  callId: string
  toolName: string
  rawArgumentsJson: string
  samplingAttemptId: string
}

interface ValidatedToolInvocation<TInput = unknown> {
  callId: string
  toolName: string
  toolVersion: string
  input: TInput
  samplingAttemptId: string
}
```

`tool_call_completed` 先产生 provider-neutral `ModelToolCallCandidate`；当前 sampling reducer/router intake 用 server-owned `samplingAttemptId` 将它包装成 `UnvalidatedToolCallEnvelope`。Provider adapter 不应伪造它不知道的 runtime attempt。router 随后依次完成 name lookup、`JSON.parse(rawArgumentsJson)` 和该 definition version 的 schema validation，成功后才构造 `ValidatedToolInvocation`。Executor 的公开签名只接受 validated invocation，不能接受 candidate/envelope/`unknown`，这样类型层就无法“忘记验证”。

`callId` 与 `samplingAttemptId` 必须从信封保留到 invocation 和 observation：前者配对 call/output，后者说明这是第几次 model sampling 产生的调用。`toolVersion` 必须从 server registry 取，不信任模型参数。`conversationId`、`tenantId`、凭证等可信 server context 也不能从模型 arguments 接收。

### 5.5 Executor context

```ts
interface ToolExecutionContext {
  runId: string
  conversationId: string
  signal: AbortSignal
  executionAttempt: number
}
```

本阶段 context 保持最小，直接执行时 `executionAttempt=1`。它与 `samplingAttemptId` 是两个轴：模型可能在第二轮 sampling 发出第一次工具执行，也可能未来对同一个调用产生多个 execution attempts。以后 tenant/user scope、deadline、traceId 可加入，但模型看不到也不能覆盖这些字段。

### 5.6 ToolResult

第一版建议用显式成功/失败 union：

```ts
type ToolResult<T = unknown>
  = | { ok: true; data: T; modelContent: string }
    | {
      ok: false
      code: 'invalid_arguments' | 'unknown_tool' | 'execution_failed'
      modelContent: string
      retryable: boolean
    }
```

`modelContent` 是给模型的 observation 摘要；`data` 是后端可查询结构。不要把 Error stack、API key 或任意异常对象序列化给模型。

### 5.7 Registry API

最小能力：

```text
register(tool)      启动/组装期注册，重复即失败
get(name)           查找 executor/definition
require(name)       未知工具转结构化错误
listDefinitions()   生成稳定排序的模型 specs
```

稳定排序能减少 prompt cache 抖动和 snapshot 噪音。第一版不支持运行中动态注册、不支持插件扫描、不支持 remote tools。

### 5.8 第一只 SEO 工具

建议 `analyze_url_structure`：

- 输入：`{ url: string }`。
- 行为：使用标准 `URL` 解析，不访问网络。
- 输出：hostname、path segments、slug、depth、query parameter names、基础结构提示。
- 风险：只读、无网络、确定性。
- metadata：明确 version、timeoutMs、requiresApproval=false、idempotent=true。
- 教学价值：有真实输入验证和结构化输出，却不引入 HTTP 超时、robots、SSRF 等 Phase 04/10 问题。

不要选择“查询真实 SERP”作为第一只工具；那会把 tool contract 学习和网络可靠性、安全、成本混在一起。

## 6. 模块边界建议

```text
apps/api/src/tools/
  tool.types.ts
  tool.errors.ts
  tool-registry.service.ts
  tool-router.service.ts
  tools.module.ts
  builtins/
    analyze-url-structure/
      definition.ts
      input.ts
      executor.ts
```

这是职责示意，不是强制文件数。一个小工具可合并 definition/parser/executor，但 registry/router 不应塞进 `AgentRuntimeService`。

NestJS 组装时，`ToolsModule` 对 runtime 导出 registry/router；built-in tools 在 module 构造期显式注册。不要使用文件系统扫描和 decorator magic。

## 7. Red-Green-Refactor

### Red

1. 重复注册同名工具，预期抛错；当前 registry 不存在。
2. 输入未知工具名，预期 `unknown_tool`，不能调用任意对象属性。
3. 输入 invalid JSON / wrong schema，预期 executor 调用次数为 0。

### Green

1. 实现 definition、registry 和一个 fake executor。
2. 实现 envelope -> lookup/parse/validate -> ValidatedToolInvocation。
3. 实现 `analyze_url_structure` 直接执行测试。

### Refactor

1. 第二个测试工具出现后再抽 generic helper。
2. 仅在 schema 与 parser 出现真实漂移时引入单源 schema 方案。
3. registry 不依赖 SEO 模块；SEO 工具依赖通用 contract。

## 8. 测试矩阵

| 层 | 场景 | 输入 | 期望 |
| --- | --- | --- | --- |
| definition | valid name/schema | 正常工具 | 可映射 ModelToolSpec |
| registry | register/get | 一个工具 | 返回同一 executor |
| registry | duplicate | 两个同名工具 | fail fast，不覆盖 |
| registry | stable list | 不同注册顺序 | 模型 specs 稳定排序 |
| router | valid envelope | 完整 JSON | typed ValidatedToolInvocation，保留 callId/samplingAttemptId/version |
| router | unknown | 不存在 name | `unknown_tool` |
| router | bad JSON | `{` | `invalid_arguments`，不执行 |
| router | wrong type | `{url:1}` | validation error |
| router | extra field | 多余字段 | 按 strict 策略拒绝 |
| executor | normal URL | https URL | 结构化结果 |
| executor | invalid URL | 非 URL | 结构化失败，无 throw 泄漏 |
| executor | abort | pre-aborted signal | 不执行或立即取消 |

## 9. 验收证据

- [ ] ToolDefinition/Envelope/ValidatedInvocation/ToolResult/ExecutionContext 类型存在且职责注释明确。
- [ ] Definition 明确 version/timeoutMs/requiresApproval/idempotent；信封明确 rawArgumentsJson/samplingAttemptId；execution context 明确 executionAttempt。
- [ ] runtime validation 覆盖 invalid JSON、缺字段、错类型、额外字段。
- [ ] registry duplicate/unknown/stable-order tests。
- [ ] definition 可映射到 Phase 01 的 `ModelToolSpec`，无 SDK 类型。
- [ ] `analyze_url_structure` 直接执行 happy/error tests。
- [ ] 工具不访问网络的测试或代码证据。
- [ ] server context 不从 model arguments 读取。
- [ ] 未将工具结果加入 UI Message 或 AgentStep；这些属于后续阶段。
- [ ] test/typecheck/lint/diff-check 结果。

## 10. 非目标

- 不把工具接进 Agent loop。
- 不做 observation 回填或第二次 sampling。
- 不执行工具 timeout/truncation/dedup；Phase 04 处理。Definition 仍必须声明 timeout/approval/idempotency/version，避免后续迁移 contract。
- 不做自动 retry；是否以及如何重试延后到 Phase 07 的 durable execution/recovery 设计。
- 不做用户审批；Phase 05 处理。
- 不做外网抓取、SERP API、浏览器自动化。
- 不做动态插件、MCP、skills。
- 不做 parallel tools。
- 不让模型提供 conversationId/tenantId/credentials。

## 11. 源码路径

### 当前项目

- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.module.ts`
- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/seo/seo.module.ts`
- `apps/api/src/seo/seo-context-builder.service.ts`
- `docs/tasks/phase-05-tool-calling/README.md`

### Codex

- `/Users/lihaoran/Desktop/codex/codex-rs/tools/src/tool_spec.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/router.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/registry.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/context.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/spec_plan.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/registry_tests.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/router_tests.rs`

## 12. 复盘问题

1. 为什么 ToolDefinition 与 ToolExecutor 不应是同一个“万能对象”？
2. TypeScript 已有 `TInput`，为什么仍需 runtime validation？
3. registry 重复名称为什么应 fail fast，而不是 last-write-wins？
4. `callId` 为什么必须从 unvalidated envelope 一直保留到 result？
5. `conversationId` 为什么不能出现在模型 schema 中？
6. 第一只工具为何刻意不联网？
7. 何时值得增加统一 schema 库，何时是过度设计？
8. stable tool order 对 prompt cache 和测试有什么价值？
9. 为什么 Codex 源码中的 `ToolCall` 名称不能自动证明 payload 已经按业务 schema 验证？
