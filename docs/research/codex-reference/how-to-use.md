# 如何使用 Codex 参考知识库

## 1. 设计讨论时的默认动作

以后你问 GPT 某个 Agent 项目设计问题时，可以直接说：

```text
参考 docs/research/codex-reference，帮我设计当前 agent 项目的 xxx。
```

GPT 应按下面顺序处理：

```text
确认当前项目代码事实
  -> 查 codex-reference 中对应专题
  -> 区分 Codex 源码事实 / 架构解释 / 当前项目迁移建议
  -> 给出最小可实现方案
  -> 标明哪些设计现在不做
  -> 如果进入正式实现，再创建 Issue 或任务文档
```

## 2. 不要让知识库变成任务看板

`codex-reference/**` 可以包含远超当前阶段的设计，例如 Goal、Memory、MCP、Plugin、Multi-agent、Exec Server、Realtime Handoff。它们的存在不代表当前项目要立刻实现。

判断是否转为正式任务，只看三个条件：

1. 当前业务是否真实需要。
2. 前置能力是否已经具备。
3. 是否能切成一个明确的最小任务并验证。

例如：

| Codex 能力 | 当前判断 |
| --- | --- |
| Tool call -> observation -> follow-up sampling | 近期必须做 |
| Tool timeout / cancel / terminal exactly-once | 近中期必须做 |
| Context compaction | 中期需要，先做 observation 截断和预算接口 |
| ThreadStore / rollout recovery | 长任务和多实例前需要 |
| MCP / Plugin / Skill | 当前只理解，不实现 |
| Multi-agent | 单 Agent baseline 稳定后再评估 |
| Goal / Memory | 有长期任务产品形态后再评估 |

## 3. GPT 查阅规则

### 3.1 问 Runtime

查：

- [core-runtime.md](./core-runtime.md)
- [durability-recovery.md](./durability-recovery.md)

重点看：

- Thread 与 Turn 是否分开。
- 一次 Run 是否可能多次 sampling。
- 请求 accepted、run started、run completed 是否是不同事件。
- active run 的 owner 是谁。

### 3.2 问 Tool Calling

查：

- [tool-loop.md](./tool-loop.md)
- [safety-permission.md](./safety-permission.md)
- [context-history.md](./context-history.md)

重点看：

- 模型只是提出 tool call；系统拥有执行权。
- raw call、validated invocation、tool output 不能混为一个对象。
- expected business error 应该成为 observation，而不是直接 500。
- UI Message 不等于 model history。

### 3.3 问 Context / RAG / Memory

查：

- [context-history.md](./context-history.md)
- [durability-recovery.md](./durability-recovery.md)
- [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md)

重点看：

- model-visible history、UI transcript、durable facts 是三种不同投影。
- RAG 或 tool output 是 untrusted data，不能升级为 system prompt。
- 先做 observation 截断、来源标记和 token budget，再讨论复杂 memory。

### 3.4 问权限 / 审批 / 安全

查：

- [safety-permission.md](./safety-permission.md)

重点看：

- Permission、Approval、Sandbox 是三层，不要混成一个 boolean。
- 写操作工具必须先有 server-side policy 和 operation identity。
- Prompt 里“不要越权”不能替代后端检查。

## 4. 方案输出模板

以后基于本知识库讨论技术方案时，GPT 应尽量按这个结构输出：

```text
1. 当前项目事实
2. Codex 对应设计
3. 可迁移的不变量
4. 当前不该迁移的复杂度
5. 最小实现方案
6. 测试与验收标准
7. 后续演进路径
```

这可以避免把 Codex 的成熟复杂度一次性搬进当前项目。
