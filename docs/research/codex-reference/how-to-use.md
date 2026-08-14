# Codex 参考知识库使用入口

本目录用于记录 Codex 源码事实、架构解释与当前项目的候选迁移方案。它不承担正式任务状态或固定阶段顺序。

## 当前项目快照

```text
阶段 1-7：Completed
Phase 8 Task 0：Active / 已实现、待验收
Minimal Compaction：Gated
Task 1：未启动
```

最新能力与边界见 [current-agent-baseline.md](./current-agent-baseline.md)。正式任务状态见 [`../../tasks/README.md`](../../tasks/README.md)，阶段路线见 [`../../roadmap.md`](../../roadmap.md)。

## 资料优先级

```text
当前 master 代码、测试、Issue / PR 与 Git 历史
  -> docs/tasks/**
  -> docs/roadmap.md
  -> docs/work-log.md
  -> codex-reference/**
  -> 旧 codex/** 与 learning-roadmap/**
```

## 专题索引

| 主题 | 参考资料 | 当前项目定位 |
| --- | --- | --- |
| Runtime / Agent Loop | [core-runtime.md](./core-runtime.md)、[tool-loop.md](./tool-loop.md) | Phase 6 已完成有界顺序 Loop 与同步执行可靠性 |
| Context Engineering | [context-history.md](./context-history.md) | Phase 7 已完成 Budget、Dynamic History、逐轮治理与 Inspector |
| RAG / Retrieval / Memory | [context-history.md](./context-history.md)、[extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | Phase 8 Task 0 Active；后续 Retrieval 与 Memory 能力未启动 |
| Permission / Approval / HITL | [safety-permission.md](./safety-permission.md) | 候选方向，尚未进入正式 Task |
| Durable Recovery / Resume | [durability-recovery.md](./durability-recovery.md) | 候选方向，当前没有跨进程恢复与 operation receipt |
| MCP / Plugin / Skill / Multi-agent | [extensibility-and-multi-agent.md](./extensibility-and-multi-agent.md) | 研究专题，不代表已经排期 |

## 迁移边界

研究方向进入正式实现，需要具备明确问题、必要前置能力、独立的最小范围和可观察验收标准，并形成 `docs/tasks/**` 规格、独立 Issue 与 `READY` Clarification Gate。

Codex 中存在某项成熟能力，只能作为架构参考，不能单独证明当前项目应立即实现它。
