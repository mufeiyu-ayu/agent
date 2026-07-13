# Agent 架构研究与学习路线

本目录是 AI SEO Agent 的长期架构研究区。它不直接充当当前任务看板，而是回答三个问题：

1. OpenAI Codex 作为成熟 Agent 产品，哪些架构思想值得学习？
2. 这些思想如何转换为当前 NestJS + Vue 云端 Agent 的实现边界？
3. Vue / TypeScript 开发者应按什么顺序理解、验证并选择性迁移这些设计？

## 研究定位

`codex/` 先独立回答 Codex 当前如何工作；`learning-roadmap/` 再把架构域翻译为学习顺序。两者都不宣称当前 Agent 项目必须照此实现，也不替代 `docs/tasks/**`。

下面是一条适合本项目背景的推荐理解顺序，不是强制发布路线：

```text
测试基座与现有状态机基线
  -> Provider-neutral 模型事件
  -> 最小 Tool Contract
  -> 模型 Tool Call 解析
  -> Tool 执行与 Observation 回填
  -> Human-in-the-loop
  -> Context 预算与压缩
  -> 可恢复执行与幂等
  -> 可观测性、评测和测试
  -> 云端权限、多租户和资源治理
  -> 扩展协议
  -> 最后才考虑 Multi-agent
```

## 证据基线

| 对象 | 本次研究快照 | 用途 |
| --- | --- | --- |
| 当前项目 | `/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef` | 判断已经完成什么、真实缺口是什么 |
| Codex fork | `/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136` | 阅读生产级客户端 Agent 的真实源码 |
| 官方文档 | [Codex App Server](https://developers.openai.com/codex/app-server)、[Codex SDK](https://developers.openai.com/codex/sdk) | 校准公开术语和协议语义 |

源码会继续演进。文档中的路径和行号只对上述本地快照负责；架构结论优先引用稳定职责，不把某个临时类型名当成永恒设计。

## 文档索引

### Codex 架构研究

| 文档 | 回答的问题 |
| --- | --- |
| [codex/README.md](./codex/README.md) | 研究入口、推荐阅读顺序和总览 |
| [codex/research-method.md](./codex/research-method.md) | 本次研究如何取证、如何区分事实与迁移建议 |
| [codex/research-progress.md](./codex/research-progress.md) | 架构域覆盖状态、批次证据和周额度记录 |
| [codex/architecture-report.md](./codex/architecture-report.md) | Codex Agent 架构详细报告 |
| [codex/architecture-learning-checklist.md](./codex/architecture-learning-checklist.md) | 值得学习的完整架构清单和检查项 |
| [codex/source-reading-map.md](./codex/source-reading-map.md) | 按调用链阅读 Codex 源码的地图 |
| [codex/feedback-and-diagnostics.md](./codex/feedback-and-diagnostics.md) | Feedback consent、诊断、附件上传与隐私边界专题 |
| [codex/assistant-directives.md](./codex/assistant-directives.md) | Assistant 文本指令、产品投影与 claim→observe→persist 专题 |
| [codex/workspace-command-and-git-status.md](./codex/workspace-command-and-git-status.md) | Remote-capable workspace command、Git/PR 状态探测与一致性专题 |
| [codex/doctor-diagnostics.md](./codex/doctor-diagnostics.md) | Doctor canonical report、并发诊断、降级与隐私投影专题 |
| [codex/rollout-state-reconciliation.md](./codex/rollout-state-reconciliation.md) | Rollout 事件事实与 SQLite 查询投影的对账专题 |
| [codex/config-diagnostics.md](./codex/config-diagnostics.md) | 分层配置、typed path、源码 span 与敏感错误渲染专题 |
| [codex/review-mode.md](./codex/review-mode.md) | Review evaluator 隔离、能力收缩、输出契约与持久化语义专题 |
| [codex/thread-fork-rollback-and-replay.md](./codex/thread-fork-rollback-and-replay.md) | Thread fork、append-only rollback、replay 与副作用补偿边界专题 |
| [codex/thread-history-pagination.md](./codex/thread-history-pagination.md) | Thread/Turn/Item 分页、cursor、live merge 与投影完整度专题 |
| [codex/thread-archive-delete-lifecycle.md](./codex/thread-archive-delete-lifecycle.md) | Archive/unarchive/delete 的 subtree、跨存储提交与可重试清理专题 |
| [codex/thread-history-injection.md](./codex/thread-history-injection.md) | Raw model history 注入的角色信任、并发归属、幂等与审计专题 |
| [codex/turn-input-admission-and-cancellation.md](./codex/turn-input-admission-and-cancellation.md) | Start/Steer/Interrupt 的队列准入、Run身份与取消结果专题 |
| [codex/thread-metadata-projection.md](./codex/thread-metadata-projection.md) | Thread name/title/preview/Git/recency 查询投影与修复专题 |
| [codex/server-request-routing.md](./codex/server-request-routing.md) | Agent反向请求客户端时的路由、抢答、重连与收口专题 |
| [codex/tool-call-execution-pipeline.md](./codex/tool-call-execution-pipeline.md) | 模型Tool Call到Observation回填、并发、hook与取消专题 |
| [codex/tool-argument-streaming.md](./codex/tool-argument-streaming.md) | Tool参数流式预览、provisional状态与最终执行校验专题 |
| [codex/tool-output-contract.md](./codex/tool-output-contract.md) | Tool输出的模型、日志、Hook、Code Mode多投影与截断专题 |
| [codex/current-project-gap-analysis.md](./codex/current-project-gap-analysis.md) | 当前项目能力、证据和缺口 |
| [codex/cloud-agent-mapping.md](./codex/cloud-agent-mapping.md) | 客户端 Codex 思想如何翻译为云端 NestJS Agent |
| [codex/terminology-map.md](./codex/terminology-map.md) | Codex、当前项目和中文助记名的概念对照 |
| [codex/research-closeout.md](./codex/research-closeout.md) | 最终覆盖、验证、已知不确定项与交付总结（收尾时生成） |

### 分阶段学习路线

| 文档 | 用途 |
| --- | --- |
| [learning-roadmap/README.md](./learning-roadmap/README.md) | Core / Advanced / Optional 学习主线和完整模块索引 |
| [learning-roadmap/progress-tracker.md](./learning-roadmap/progress-tracker.md) | 已读调用链、Teach-back、实验与未知问题 |
| [learning-roadmap/learning-method.md](./learning-roadmap/learning-method.md) | 从源码事实到可验证理解的方法 |
| [learning-roadmap/checklist-phase-matrix.md](./learning-roadmap/checklist-phase-matrix.md) | 架构域、学习模块、源码文档、建议深度与项目需要 |
| [learning-roadmap/operation-identity-lab.md](./learning-roadmap/operation-identity-lab.md) | 从Codex竞态案例学习operation、generation、idempotency与receipt |
| [learning-roadmap/turn-admission-race-lab.md](./learning-roadmap/turn-admission-race-lab.md) | 用纯TypeScript验证Run准入、Steer归属与取消竞态 |

每个兼容 `phase-*` 路径代表一个学习模块，并固定包含：

- `README.md`：学习问题、边界、架构设计和可选练习。
- `source-reading.md`：Codex 与当前项目的源码阅读路径。
- `practice-and-acceptance.md`：练习、测试矩阵、验收证据和复盘问题。

## 推荐阅读路径

### 第一次阅读

1. [Codex 架构详细报告](./codex/architecture-report.md)
2. [当前项目差距分析](./codex/current-project-gap-analysis.md)
3. [云端架构映射](./codex/cloud-agent-mapping.md)
4. [学习路线总览](./learning-roadmap/README.md)
5. 当前阶段目录

### 准备把某个主题转为正式实现

1. 阅读模块 `README.md`，先确认范围和不做什么。
2. 按 `source-reading.md` 沿一条真实调用链阅读。
3. 在 `practice-and-acceptance.md` 中先写 Red 验证，再做最小实现。
4. 把实现任务落到 `docs/tasks/`，不要直接把研究文档当任务单。

### 学习收口

1. 用源码、测试、Teach-back 或小型实验填写学习证据。
2. 更新 [progress-tracker.md](./learning-roadmap/progress-tracker.md)。
3. 只有主题已转为正式任务时，才按验收流程同步 `docs/tasks/**` 与 `docs/roadmap.md`。

## Research 与 Tasks 的边界

| 目录 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `docs/research/` | 研究结论、架构地图、长期学习路线 | 宣称当前代码已经实现 |
| `docs/tasks/` | 当前可执行任务、TDD 步骤和验收状态 | 存放长篇外部项目研究 |
| `docs/roadmap.md` | 项目阶段状态总览 | 展开每个架构主题的细节 |

研究路线可以比当前任务走得更远，但任何“已完成”都必须由当前代码、测试或运行结果证明。
