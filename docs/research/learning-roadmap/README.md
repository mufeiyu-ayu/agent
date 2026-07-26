# 历史分阶段学习路线

本目录保留此前基于 Codex 架构拆解形成的研究型学习材料。它包含 Context、Recovery、HITL、MCP、Multi-agent 等完整专题，但**不再代表当前项目的正式阶段编号、执行顺序或任务状态**。

## 当前使用规则

正式路线只看：

- [`../../roadmap.md`](../../roadmap.md)；
- [`../../tasks/README.md`](../../tasks/README.md)；
- [`../codex-reference/current-agent-baseline.md`](../codex-reference/current-agent-baseline.md)。

当前唯一确定的下一阶段是：

```text
阶段 6：有界单 Agent Loop
```

阶段 6 完成前，不提前编号或编写后续正式阶段。

## 本目录的用途

这里的各专题文件可以用于：

- 学习成熟 Agent 系统如何处理 Context、恢复、权限、扩展和 Multi-agent；
- 在真实业务问题出现时快速定位已有研究；
- 为未来可能的正式 Task 提供概念、源码入口、风险和测试参考。

这里的文件不能用于：

- 宣称某项能力已经实现；
- 自动把某个研究 Phase 变成当前项目下一阶段；
- 绕过 `docs/tasks/**`、Issue、Clarification Gate 和验收流程；
- 因为 Codex 存在某项设计，就默认当前项目立即复制。

## 迁移为正式 Task 的门槛

研究专题只有同时满足以下条件，才能进入正式路线：

1. 当前项目出现真实业务或工程问题；
2. 现有代码具备必要前置能力；
3. 能缩减为一个明确、可测试、可验收的 Task；
4. 用户与 GPT 确认其学习收益和优先级；
5. 规格写入 `docs/tasks/**` 并创建独立 Issue。

## 当前建议阅读

阶段 6 优先阅读：

- [`../codex-reference/core-runtime.md`](../codex-reference/core-runtime.md)；
- [`../codex-reference/tool-loop.md`](../codex-reference/tool-loop.md)；
- [`../codex-reference/current-agent-baseline.md`](../codex-reference/current-agent-baseline.md)。

其他专题继续保留为历史研究快照，需要时按问题查阅，不按原编号机械执行。
