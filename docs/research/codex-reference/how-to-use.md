# 如何使用 Codex 参考知识库

## 1. 设计讨论时的默认动作

以后讨论 Agent 项目设计问题时，GPT 应按下面顺序处理：

```text
确认远程 master 与当前任务事实
  -> 查 codex-reference 中对应专题
  -> 区分 Codex 源码事实 / 架构解释 / 当前项目迁移建议
  -> 判断真实业务价值和前置条件
  -> 给出最小可实现方案
  -> 明确哪些设计现在不做
  -> 用户确认后写入 docs/tasks 并创建 Issue
```

研究资料不能覆盖当前代码事实，也不能替代正式任务状态。

## 2. 不要让知识库变成任务看板

`codex-reference/**` 可以包含远超当前阶段的 Context、Recovery、Permission、MCP、Plugin、Multi-agent 等设计。它们的存在不代表当前项目要立刻实现。

判断是否转为正式 Task，至少看四个条件：

1. 当前业务是否真实需要；
2. 前置能力是否已经具备；
3. 是否能切成一个明确的最小任务并验证；
4. 相比其他候选方向，当前学习收益是否更高。

当前项目判断：

| 能力 | 当前状态 |
| --- | --- |
| 一次 Tool Call -> Observation -> 第二轮 sampling | 已在阶段 5 完成 |
| Tool timeout / abort / AgentStep / terminal consistency | 已在阶段 5 完成基础 |
| 有界多次顺序 Tool Call | 阶段 6 当前主线 |
| 最小 Tool pair 与 model input 正确性 | 阶段 6 横向不变量 |
| 完整 Context Budget / Compaction | 研究资料；出现真实容量、成本或质量压力后再评估 |
| 写工具 / Permission / HITL | 研究资料；确定真实低风险写操作后再评估 |
| Durable Recovery | 研究资料；长任务、多实例或副作用出现后再评估 |
| MCP / Plugin / Skill | 当前只理解，不实现 |
| Multi-agent | 单 Agent 有界 Loop 稳定后仍需证明真实必要性 |

## 3. GPT 查阅规则

### 3.1 问 Runtime / Agent Loop

查：

- [core-runtime.md](./core-runtime.md)；
- [tool-loop.md](./tool-loop.md)；
- [current-agent-baseline.md](./current-agent-baseline.md)。

重点看：

- 一个 Run 为什么可能包含多次 sampling；
- 模型决策与 Runtime 控制权如何分离；
- follow-up sampling 如何根据 Observation 继续；
- `maxSamplingRounds`、`maxToolCalls` 和终止条件由谁拥有；
- accepted、running、completed、failed、aborted 是否是不同事实。

### 3.2 问 Tool Calling

查：

- [tool-loop.md](./tool-loop.md)；
- [safety-permission.md](./safety-permission.md)；
- [context-history.md](./context-history.md)。

重点看：

- 模型只是提出 Tool Call，系统拥有执行权；
- raw call、validated invocation、Tool Result 不能混为一个对象；
- expected business error 应成为 Observation，而不是直接变成不可解释的 500；
- Tool Call / Result 必须配对并保持顺序；
- UI Message 不等于 model input。

### 3.3 问 Context / RAG / Memory

查：

- [context-history.md](./context-history.md)；
- [durability-recovery.md](./durability-recovery.md)；
- [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md)。

重点看：

- model-visible history、UI transcript、runtime event、durable facts 是不同数据；
- RAG 或 Tool Result 是低信任数据，不能升级为 system policy；
- 优先使用业务字段投影和结构化限制，字符硬截断只作为异常保护；
- 只有实测出现上下文容量、成本、延迟或质量问题，才讨论完整预算、摘要和 Compaction。

### 3.4 问权限 / 审批 / 安全

查：

- [safety-permission.md](./safety-permission.md)。

重点看：

- Permission、Approval、Sandbox 是不同层次；
- 写操作工具必须先有 server-side policy 与 operation identity；
- Prompt 中“不要越权”不能替代后端检查；
- 当前只读工具无需人为制造审批流程。

### 3.5 问 Recovery / Multi-agent

查：

- [durability-recovery.md](./durability-recovery.md)；
- [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md)。

先回答：

- 当前是否存在跨进程长任务或不可重复副作用；
- 单 Agent 是否已经稳定完成有界多步骤任务；
- 新复杂度是否解决了已观察到的问题；
- 是否可以用更简单的顺序 Loop 或普通代码完成。

没有真实证据时，不迁移为正式 Task。

## 4. 方案输出模板

基于本知识库讨论技术方案时，建议按以下结构：

```text
1. 当前项目事实
2. 当前真实问题
3. Codex 对应设计
4. 可迁移的不变量
5. 当前不该迁移的复杂度
6. 最小实现方案
7. 测试与验收标准
8. 启动后续能力的客观触发条件
```

这可以避免把成熟 Agent 产品的复杂度一次性搬入当前项目，也避免因为一次质疑就随意改变路线。
