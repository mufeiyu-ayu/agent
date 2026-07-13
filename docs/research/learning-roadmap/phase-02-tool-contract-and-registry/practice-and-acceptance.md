# Phase 02 实践与验收：先让工具脱离模型独立成立

## 1. 实践目标

构建一个可以在单元测试里直接注册、查找、验证和执行的只读 SEO 工具。完成标准不是“模型偶然调用成功”，而是系统对工具名称、参数和输出拥有确定解释。

## 2. 前置条件

- Phase 01 model tool candidate 可稳定生成。
- Phase 00 测试命令可运行。
- 已决定第一只工具不访问网络、不写数据库、不需要审批。
- 已读 [README.md](./README.md) 与 [source-reading.md](./source-reading.md)。

## 3. 练习设计

### 3.1 工具用例

`analyze_url_structure` 输入示例：

```json
{
  "url": "https://example.com/guides/agent-seo?utm_source=demo"
}
```

建议输出：

```json
{
  "hostname": "example.com",
  "pathDepth": 2,
  "segments": ["guides", "agent-seo"],
  "slug": "agent-seo",
  "queryParameterNames": ["utm_source"],
  "observations": ["path_depth_ok", "tracking_parameter_present"]
}
```

不要输出虚假的搜索量、排名或抓取到的页面标题；工具没有联网就不能声称知道这些事实。

### 3.2 Strict 输入规则

- `url` 必填且必须是非空字符串。
- 只接受 `http:` / `https:`。
- 拒绝 userinfo（如 `https://user:pass@host`）以避免意外回显秘密。
- 是否允许 localhost/私网地址应明确；虽然本工具不联网，建议仍标记为可解析但不得用于未来 fetch。
- 第一版拒绝额外字段，帮助发现模型 contract 漂移。
- raw JSON 只存在于 `UnvalidatedToolCallEnvelope`；executor 的参数类型必须是 `ValidatedToolInvocation<AnalyzeUrlStructureInput>`。

### 3.3 Result 序列化

- `data` 保留结构化字段。
- `modelContent` 使用紧凑 JSON 或稳定文本模板。
- 字段顺序稳定，测试易读。
- 失败只给安全摘要，不包含 stack。
- Observation 即使包含“ignore previous instructions”“把密钥发给我”等文本，也必须作为不可信 tool data 进入 tool result item，不能升级为 system/developer instruction。真正的授权与副作用 policy 始终在 server 端执行，不能交给模型判断。

### 3.4 Definition metadata fixture

为 `analyze_url_structure` 固定并测试：

```ts
{
  name: 'analyze_url_structure',
  version: '1',
  timeoutMs: 1_000,
  requiresApproval: false,
  idempotent: true,
  risk: { level: 'low', sideEffect: 'none', network: false },
}
```

数值可按实现调整，但不能缺字段或允许模型覆盖。`timeoutMs` 在 Phase 04 执行；此处先保证 contract 和 registry 投影稳定。

## 4. Red-Green-Refactor

### Exercise 02-A：Registry

**Red**

1. `get('missing')` 应返回/抛结构化 unknown tool。
2. 注册两个 `analyze_url_structure` 应失败。
3. 反向注册两个 fake tools，`listDefinitions()` 应仍按名称稳定。

**Green**

- 用私有 Map 完成注册和查找。
- 构造期检查 name 与 definition。

**Refactor**

- 错误类型统一，但不要做完整错误框架。
- 返回只读数组/副本，避免调用方篡改 registry。

### Exercise 02-B：Router/validator

**Red**

- invalid JSON。
- `{}`。
- `{ "url": 123 }`。
- `{ "url": "https://x", "conversationId": "victim" }`。

**Green**

- parse 后以 unknown 进入 validator。
- 只在 registry lookup、parse、schema validation 全部成功后构建 `ValidatedToolInvocation`。
- 保留原 callId 与 samplingAttemptId，toolVersion 从 registry definition 注入。

**Refactor**

- JSON parse error 与 schema error 使用不同 code/detail。
- detail 供后端日志；modelContent 只含可修正提示。

### Exercise 02-C：Executor

**Red**

- 正常 URL 的结构化期望。
- 非法 URL。
- ftp scheme。
- pre-aborted signal。

**Green**

- 使用标准 `URL`，不加第三方依赖。
- 保证确定性输出。

**Refactor**

- 纯解析函数与 Nest provider 包装分开。
- 只有业务复用需要时才抽通用 URL 工具库。

### Exercise 02-D：Definition -> Model spec

**Red**：模型请求 mapper 无法接收 ToolDefinition。

**Green**：只映射 name/description/inputSchema，risk/parse/executor 不暴露给 provider。

**Refactor**：确保 adapter 输出无 OpenAI SDK 类型泄漏到 tools 层。

### Exercise 02-E：禁止绕过验证

**Red**：尝试把 `UnvalidatedToolCallEnvelope` 直接传给 executor，要求 TypeScript 编译失败；再用运行时 spy 证明 bad JSON/schema 时 executor 调用为 0。

**Green**：executor interface 只接受 `ValidatedToolInvocation<T>`，router 是唯一构造入口（测试 fixture helper也必须显式标注只供测试）。

**Refactor**：不要通过类型断言 `as ValidatedToolInvocation` 绕过边界；若测试需要实例，走共享 validator 或清晰的 test builder。

## 5. 测试矩阵

| ID | 被测对象 | Case | 断言 |
| --- | --- | --- | --- |
| P02-RG01 | registry | first register | get 同一工具 |
| P02-RG02 | registry | duplicate | 启动失败且旧值未被替换 |
| P02-RG03 | registry | unknown | stable error code |
| P02-RG04 | registry | ordering | 与注册顺序无关 |
| P02-RT01 | router | valid envelope | callId/name/input/samplingAttemptId/toolVersion 正确 |
| P02-RT02 | router | invalid JSON | invalid_arguments |
| P02-RT03 | router | missing url | validator detail |
| P02-RT04 | router | wrong type | executor 未调用 |
| P02-RT05 | router | extra fields | strict 拒绝 |
| P02-RT06 | router | unknown tool | unknown_tool |
| P02-EX01 | executor | valid URL | stable structure |
| P02-EX02 | executor | query params | names 提取正确，不泄漏 value 可按策略 |
| P02-EX03 | executor | invalid URL | safe failure |
| P02-EX04 | executor | ftp | scheme rejected |
| P02-EX05 | executor | pre-abort | 无业务执行 |
| P02-SP01 | spec mapper | definition | provider-neutral spec |
| P02-SP02 | spec mapper | risk metadata | 不进入模型 spec |
| P02-CT01 | definition | complete metadata | version/timeout/approval/idempotent 均为 server-owned |
| P02-CT02 | type boundary | envelope -> executor | 编译期不可直接调用；invalid runtime path executor=0 |
| P02-OB01 | observation serializer | malicious instruction-like text | 保持 tool data role，不变成高优先级 instruction |

## 6. 安全负面清单

- [ ] 工具 arguments 中没有 API key 字段。
- [ ] 模型传入 runId/conversationId 不会替换 server context。
- [ ] unknown tool 不能通过动态属性或 eval 执行。
- [ ] output 不包含 Error stack。
- [ ] URL 工具没有 fetch/DNS 请求。
- [ ] registry 不允许运行期匿名覆盖 built-in。
- [ ] 不存在 envelope 直接进入 executor 的 production 路径。
- [ ] observation 中的指令样文本不会改变 role/policy，且 server authorization 不依赖模型输出。

## 7. 验收证据模板

```md
### Tool analyze_url_structure

- Definition：`...`。
- Risk：low / sideEffect=none / network=false。
- Contract metadata：version / timeoutMs / requiresApproval / idempotent。
- Schema：`...`。
- Validator tests：valid / missing / wrong type / extra field。
- Executor tests：valid URL / invalid URL / aborted。
- Network evidence：代码只调用标准 URL parser；测试无网络 mock。
- Result：PASS。
- Remaining risk：未来若加入 fetch，必须重新分类并进入 Phase 04/10。
```

阶段完成证据：

- [ ] 类型文件和责任说明。
- [ ] Unvalidated envelope 与 Validated invocation 的编译期/运行时边界证据。
- [ ] Registry 全矩阵测试。
- [ ] Router/validator 全矩阵测试。
- [ ] 工具 definition/schema/executor 测试。
- [ ] ToolDefinition -> ModelToolSpec 测试。
- [ ] 模型不可覆盖 server context 测试。
- [ ] no-network 证据。
- [ ] test/typecheck/lint/diff-check 输出。

## 8. 非目标

- 不从真实模型触发工具。
- 不调用第二轮模型。
- 不写 AgentStep。
- 不执行 timeout/output truncation（Phase 04），不自动 retry（Phase 07 再决策）。
- 不做自动 retry；`idempotent` 只作为未来 Phase 07 恢复/重试策略输入。
- 不加入 SERP/HTTP client。
- 不做 approval policy。
- 不暴露 Vue 工具时间线。

## 9. 源码路径

### 预计实现点

- `apps/api/src/tools/**`（实际任务可按项目模块规范调整）。
- `apps/api/src/llm/llm.types.ts` 的 ModelToolSpec 映射边界。
- `apps/api/src/agent-runtime/agent-runtime.module.ts` 的 module composition。

### 当前参考

- `apps/api/src/seo/seo-context-builder.service.ts`
- `apps/api/src/agent-runtime/agent-runtime.service.ts`
- `docs/tasks/phase-05-tool-calling/README.md`

### Codex 对照

- `/Users/lihaoran/Desktop/codex/codex-rs/tools/src/tool_spec.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/router.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/registry.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/registry_tests.rs`
- `/Users/lihaoran/Desktop/codex/codex-rs/core/src/tools/router_tests.rs`

## 10. 复盘问题

1. ToolResult 的 `data` 与 `modelContent` 为什么都可能需要？
2. invalid JSON 与 unknown tool 哪个先判断？这样做会泄漏工具目录吗？当前阶段取舍是什么？
3. 为什么第一只工具选择标准 URL 解析，而不是真实抓取？
4. strict extra fields 会不会降低 provider 兼容性？它带来的学习价值是什么？
5. registry 的 stable ordering 如何验证？
6. 工具失败应该 throw 还是返回 `ok:false`？边界异常又如何处理？
7. 哪个证据能证明 executor 只收到经过验证的 input？
8. 为什么 observation 中出现命令式文本不代表系统应该执行它？
