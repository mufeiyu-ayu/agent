# Phase 02 源码阅读：Tool Spec、Router 与 Registry 的确定性边界

## 1. 阅读目标

本阶段阅读 Codex 不是为了复制数十种工具，而是抽取三个不变量：

1. 模型可见 spec 与真实 executor 必须对应。
2. provider output 要先路由成未验证调用信封，再经过 registry lookup、parse 和 schema validation，才能执行。
3. registry 对名称冲突和未知工具必须有确定行为。

## 2. 前置条件

- Phase 01 已区分 model event 与 runtime event。
- 已读本阶段 [README.md](./README.md) 的概念表。
- 能忽略 Rust trait/generic 细节，优先看职责和测试。

## 3. Codex 阅读路线

### Step 1：ToolSpec 是模型契约

文件：`/Users/ayu/Desktop/codex/codex-rs/tools/src/tool_spec.rs`

定位 `ToolSpec`：Codex 支持 Function、Namespace、ToolSearch、WebSearch、Freeform 等多种 spec。当前项目只需要 function-like 工具。

阅读问题：

- 为什么 `ToolSpec::name()` 可以统一取名称？
- 为什么 serialization 在 tools crate，而不在 session turn？
- 当前项目如何用更小的 `ModelToolSpec` 避免复制不需要的 variant？

### Step 2：ResponseItem 保留 raw arguments

文件：`/Users/ayu/Desktop/codex/codex-rs/protocol/src/models.rs`

定位 `ResponseItem::FunctionCall` / `FunctionCallOutput`。注释说明 arguments 是 JSON string，并保留 `call_id`。记录 call/output 配对字段。raw string 被装进结构体后仍是不可信 wire payload，不代表已按业务 schema 验证。

### Step 3：ToolRouter 负责翻译，不执行业务

文件：`/Users/ayu/Desktop/codex/codex-rs/core/src/tools/router.rs`

定位：

- `ToolCall`。
- `model_visible_specs()`。
- `build_tool_call()`。
- `dispatch_tool_call()`（如当前快照存在）。

观察 `build_tool_call` 如何把 FunctionCall/CustomToolCall 转成统一内部 call。Codex 的 `ToolCall { tool_name, call_id, payload }` 是路由信封：普通 function payload 仍保存 raw arguments，具体 handler/runtime 后续才解析。不要因类型名叫 `ToolCall` 就误称已经验证。

当前项目 Phase 01 已经先归一化 provider event，所以建议用更强的名称表达：`UnvalidatedToolCallEnvelope -> lookup -> JSON.parse -> schema validate -> ValidatedToolInvocation`。Executor 只接受最后一种类型。

### Step 4：Registry 是确定性 dispatch 表

文件：`/Users/ayu/Desktop/codex/codex-rs/core/src/tools/registry.rs`

定位 `ToolRegistry` 与注册/dispatch 方法。记录：

- tool name 到 handler 的映射。
- handler 是否支持并行等 metadata。
- unknown handler 如何变成错误。
- spec 与 handler 如何在组装时保持一致。

`ToolRegistry::from_tools` 遇到重复名时调用 `error_or_panic` 并跳过后一个条目；这是 Codex 当前快照的具体行为，不等同于返回 `Result` 的启动失败 API。当前项目可以选择更严格的 fail-fast exception，但应标明这是迁移决策，不是假称 Codex 使用同一接口。

不要复制 Codex 所有 exposure/lifecycle/hook 能力；当前最小 registry 只需 register/get/list。

### Step 5：组装计划

文件：`/Users/ayu/Desktop/codex/codex-rs/core/src/tools/spec_plan.rs`

只看 tool router 如何由 context/config 组装。学习“显式 composition”而非具体 feature flags。当前项目可以在 Nest module 组装 built-ins，不需要动态 feature matrix。

### Step 6：先读测试再回源码

文件：

- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/registry_tests.rs`
- `/Users/ayu/Desktop/codex/codex-rs/core/src/tools/router_tests.rs`

优先看：

- TestHandler 如何最小实现 executor。
- namespace/name 如何成为 registry key。
- dispatch lifecycle、namespaced/plain key 与 parallel metadata 如何断言。不要声称该文件已经替当前项目覆盖 strict JSON schema validation；那是当前项目要新增的测试。

把其中与当前阶段无关的 hooks、namespaces、MCP、parallel 标为跳过。

## 4. 当前项目阅读路线

### A. Module composition

文件：

- `apps/api/src/agent-runtime/agent-runtime.module.ts`
- `apps/api/src/seo/seo.module.ts`
- `apps/api/src/app.module.ts`

画出 ToolsModule 将来应该被谁 import、导出什么。避免 SeoService 自己 `new Map()` 注册工具，也避免 controller 知道 executor。

### B. Provider-neutral spec

文件：`apps/api/src/llm/llm.types.ts`

检查 Phase 01 的 `ModelToolSpec` 是否只包含 provider-neutral 字段。ToolDefinition 到 ModelToolSpec 的 mapper 应放在 tools 或 llm adapter 边界，不应让 tool import OpenAI SDK。

### C. Runtime 接口

文件：`apps/api/src/agent-runtime/agent-runtime.service.ts`

本阶段只标记未来接入点，不修改 loop：

- sampling 前从 registry 取 model specs。
- 收到 unvalidated envelope 后交给 router/validator。
- executor 通过 server context 执行。

如果发现 runtime 要知道某个具体 SEO tool 类名，设计就是耦合的。

## 5. 设计对照表

| Codex | 当前项目最小翻译 | 暂不迁移 |
| --- | --- | --- |
| `ToolSpec` 多 variant | `ModelToolSpec` function-only | namespace/freeform/web search |
| `ResponseItem::FunctionCall` | Phase 01 unvalidated envelope | 全量 ResponseItem |
| `ToolRouter` | parse + validate + resolve | MCP/dynamic routing |
| `ToolRegistry` | deterministic Map | runtime dynamic registration |
| handler/runtime | typed executor | sandbox runtime |
| parallel metadata | risk metadata 先行 | 并行调度 |

## 6. 源码阅读实验

选择 `analyze_url_structure`，手写从定义到执行的六个对象：

1. definition。
2. model spec。
3. model candidate（provider call id/name/raw JSON/index）。
4. unvalidated envelope（candidate + samplingAttemptId）。
5. validated invocation（typed input + server-side toolVersion）。
6. ToolResult。

检查哪些字段每层新增、哪些字段不应跨层。特别确认：rawArgumentsJson/samplingAttemptId 属于 envelope；toolVersion 来自 registry；executionAttempt 来自执行边界；server context 不在 model spec/envelope 内。

## 7. Red-Green-Refactor

### Red

- 用同名 TestHandler 注册两次，写出期望错误。
- envelope 的 name 不存在，写出结构化 unknown result。
- `{ "conversationId": "other" }` 不能改变执行上下文。

### Green

- 最小 Map registry。
- 单函数 mapper/router。
- 一个 pure executor。

### Refactor

- 只有第二个工具出现后，才证明公共 parser/result helper 的真实需求。
- 把 spec 与 execution context 明确隔离。

## 8. 测试矩阵

| 阅读结论 | Test |
| --- | --- |
| spec 与 handler 同名 | registry construction test |
| duplicate 必须拒绝 | duplicate registration test |
| unknown 不得动态执行 | unknown call test |
| raw args 要验证 | envelope 不能直达 executor + invalid JSON/schema tests |
| call/output 关联 | callId preservation test |
| server context 可信 | model input cannot override context test |
| model tool order 稳定 | listDefinitions order test |

## 9. 验收证据

- [ ] 画出 definition -> spec -> unvalidated envelope -> validated invocation -> result。
- [ ] 完成 Codex/当前项目职责对照表。
- [ ] 阅读 registry/router 各至少两条测试。
- [ ] 写出 duplicate、unknown、invalid args 三个不变量。
- [ ] 指出至少三项当前不迁移的 Codex tool 能力。
- [ ] 给第一只 SEO 工具写风险 metadata 和不联网理由。
- [ ] 写明 Codex ToolCall 是路由信封、当前 ValidatedToolInvocation 是更强业务边界。
- [ ] 核对 `ToolRegistry::from_tools` 的真实重复名行为，不把迁移策略写成 Codex 事实。

## 10. 非目标

- 不读 Codex 所有 tool handlers。
- 不读 shell sandbox/approval 实现。
- 不研究 MCP、extensions、tool search。
- 不实现 runtime loop。
- 不比较插件生态。

## 11. 源码路径速查

### Codex

- `codex-rs/tools/src/tool_spec.rs`
- `codex-rs/protocol/src/models.rs`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/context.rs`
- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/src/tools/registry_tests.rs`
- `codex-rs/core/src/tools/router_tests.rs`

### 当前项目

- `apps/api/src/llm/llm.types.ts`
- `apps/api/src/agent-runtime/agent-runtime.module.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `apps/api/src/seo/seo.module.ts`
- `apps/api/src/app.module.ts`

## 12. 复盘问题

1. 为什么 model-visible specs 与 registry contents 必须一致？
2. router 是否应该 catch executor 所有异常？Phase 02 与 Phase 04 的答案有何差别？
3. Codex namespace 在当前项目有没有真实需求？
4. 一个 Map 为什么也值得抽成 Registry？它保护了哪些不变量？
5. 具体 SEO 工具应该依赖 runtime，还是 runtime 依赖 tool contract？
6. 如何验证模型无法越权覆盖 server context？
7. 为什么读取测试往往比通读 registry.rs 更高效？
8. 为什么 raw arguments 被包进结构体后仍然不能直接进入 executor？
