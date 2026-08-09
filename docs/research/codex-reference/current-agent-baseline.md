# Agent 项目基线：历史兼容入口

> 本文件原先记录 **Phase 6 启动前** 的项目基线与缺口。Phase 6 已于 2026-08-09 完成，因此原正文中的“当前只有一次 Tool Call”“Phase 6 是下一阶段”等描述已经失效，不再作为当前事实维护。

## 当前事实入口

请以以下资料判断项目现状：

1. [`../../tasks/README.md`](../../tasks/README.md)：正式 Task 状态；
2. [`../../roadmap.md`](../../roadmap.md)：阶段级路线；
3. [`../../tasks/completed/phase-06-bounded-agent-loop.md`](../../tasks/completed/phase-06-bounded-agent-loop.md)：Phase 6 最终能力、可靠性与验证归档；
4. 当前 `master` 代码、测试、Issue / PR 与 Git 历史。

## Phase 6 完成后的真实基线

```text
阶段 1-6：Completed

Agent Runtime：
  bounded sequential loop
  3 sampling / 2 Tool Call 默认预算
  search_articles + get_article_detail
  DeepSeek thinking continuation
  Run deadline / Tool timeout / Abort
  PostgreSQL statement / lock timeout
  late-result ownership fencing
  atomic terminalization

当前 Agent 主线：无 Active Task
下一正式阶段：尚未定案
```

## 历史用途

若需要研究“项目从最小 Tool Calling 升级到 bounded Agent Loop 之前缺什么”，请查看本文件在 Git 历史中的 Phase 6 启动前版本，以及：

- [`../codex/`](../codex/README.md) 的旧 Codex 源码研究；
- [`../learning-roadmap/`](../learning-roadmap/README.md) 的历史学习路线；
- Phase 6 的 Issue #25、#27、#29、#31 与对应 PR。

这些资料用于历史复盘，不得覆盖当前 `docs/tasks/**` 的正式状态。
