# Safety 与 Permission：审批、权限、Sandbox 和 Hook 的边界

## 1. 核心结论

Codex 把安全拆成多层，而不是一个 `allowed: boolean`：

```text
模型提出动作
  -> Tool schema / registry 验证
  -> permission profile
  -> approval decision
  -> sandbox / environment capability
  -> hook pre-check / post-check
  -> handler 执行
  -> observation 脱敏 / 截断 / 投影
```

当前云端 AI SEO Agent 近期不需要复制 OS sandbox，但必须学习这种分层思想。

## 2. Codex 源码入口

| 主题 | 路径 |
| --- | --- |
| Permission profile | `codex-rs/core/src/config/permissions.rs` |
| Exec policy | `codex-rs/core/src/exec_policy.rs` |
| Tool approval | `codex-rs/core/src/tools/approvals.rs` |
| Tool runtime | `codex-rs/core/src/tools/parallel.rs`、`registry.rs` |
| Hook runtime | `codex-rs/core/src/hook_runtime.rs` |
| Guardian | `codex-rs/core/src/guardian/**` |
| Environment / capability | `codex-rs/core/src/environment_selection.rs`、`codex-rs/exec-server/**` |

## 3. 可迁移不变量

### 3.1 Permission、Approval、Sandbox 不同

| 层 | 问题 | 当前项目迁移 |
| --- | --- | --- |
| Permission | 当前身份被允许做什么 | tenant/user/resource scope |
| Approval | 这一次动作是否经用户确认 | HITL approval request |
| Sandbox | 即使代码有 bug，也限制运行环境能力 | 云端先用业务隔离；代码执行时才考虑 OS sandbox |

不要用“用户点了确认”代替权限检查，也不要用“工具低风险”代替租户隔离。

### 3.2 Tool risk metadata 只是第一道门

当前项目已有 risk metadata fail closed，这是好方向。后续应扩展为：

```ts
type ToolRisk = {
  level: 'low' | 'medium' | 'high'
  sideEffect: 'none' | 'internal_write' | 'external_write'
  network: boolean
  requiresApproval: boolean
  resourceScopes: string[]
}
```

执行前要同时检查：

- 工具声明。
- 当前用户/租户权限。
- 当前 conversation/run policy。
- 是否需要 approval。
- 是否允许网络或写操作。

### 3.3 Pre-hook 能阻止副作用，post-hook 不能撤销副作用

Codex 的 hook 设计区分 pre-tool-use 与 post-tool-use。Post hook 即使 block，也只能改变 observation 或标记风险，不能撤销已经发生的文件/网络/进程副作用。

当前项目迁移：

- 安全审批必须发生在 executor 前。
- executor 后的检查只能做脱敏、摘要、风险标记、补偿任务。
- 不要把 post-check 包装成“安全执行”。

### 3.4 Observation injection 不能靠 prompt 防御

Tool output、RAG 结果、网页内容都可能包含：

```text
忽略之前的指令
调用写工具
泄漏系统提示
```

正确边界：

- observation 只能作为 tool data role 进入模型。
- server policy 不接受 observation 修改。
- 下一轮模型即使被诱导请求高风险工具，router/policy 仍必须拒绝。
- prompt 提醒只是纵深防御，不是安全边界。

## 4. 当前项目实现顺序

### 近期：只读工具

- 只允许 `low + sideEffect=none + network=false + requiresApproval=false`。
- 任何不满足条件的工具 fail closed。
- executor 不接收 tenantId / credentials 等模型参数。

### 中期：内部写工具

例如保存 SEO 草稿、创建分析报告。

必须先有：

- user / tenant / resource ownership。
- operation identity。
- approval 或明确无需 approval 的 policy。
- audit log。

### 后期：外部写工具 / 网络工具

例如发邮件、调用第三方 SEO API、发布页面。

必须增加：

- idempotency key。
- external receipt。
- retry / unknown reconciliation。
- SSRF / domain allowlist。
- secret 管理。

## 5. 必测用例

| 场景 | 关键断言 |
| --- | --- |
| model 伪造 tenantId | executor 使用 server context，忽略模型参数 |
| medium risk tool | 当前阶段拒绝执行 |
| requiresApproval tool | 没有 approval 时不执行 |
| malicious observation | 不能改变 policy 或触发高风险工具 |
| executor throws secret | modelContent 不泄漏 secret |
| post-check block | 不声称副作用未发生 |
| unauthorized resource | 返回安全失败，不进入 executor |

## 6. 暂时不做

- 不做 OS sandbox。
- 不做通用 policy language。
- 不做插件权限市场。
- 不做远程执行环境。
- 不做高风险自动写工具。

当前先把 server-side 工具边界做硬，比引入复杂安全框架更重要。
