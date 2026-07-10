# Agent 架构研究与学习路线

本目录是 AI SEO Agent 的长期架构研究区。它不直接充当当前任务看板，而是回答三个问题：

1. OpenAI Codex 作为成熟 Agent 产品，哪些架构思想值得学习？
2. 这些思想如何转换为当前 NestJS + Vue 云端 Agent 的实现边界？
3. 从当前阶段 5 开始，应该按什么顺序学习、实现和验证？

## 当前结论

当前项目已经完成 Session Chat、消息持久化、NDJSON Streaming、停止生成、`AgentRun` / `AgentStep`、内部 `AgentRuntimeEvent` 和 `SeoContextBuilder`。下一步不是复制 Codex，而是沿着下面的主线继续演进：

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
| 当前项目 | `/Users/ayu/Desktop/agent`，`master@0a0b835` | 判断已经完成什么、真实缺口是什么 |
| Codex fork | `/Users/ayu/Desktop/codex`，`main@626147f72` | 阅读生产级客户端 Agent 的真实源码 |
| 官方文档 | [Codex App Server](https://developers.openai.com/codex/app-server)、[Codex SDK](https://developers.openai.com/codex/sdk) | 校准公开术语和协议语义 |

源码会继续演进。文档中的路径和行号只对上述本地快照负责；架构结论优先引用稳定职责，不把某个临时类型名当成永恒设计。

## 文档索引

### Codex 架构研究

| 文档 | 回答的问题 |
| --- | --- |
| [codex/README.md](./codex/README.md) | 研究入口、推荐阅读顺序和总览 |
| [codex/research-method.md](./codex/research-method.md) | 本次研究如何取证、如何区分事实与迁移建议 |
| [codex/architecture-report.md](./codex/architecture-report.md) | Codex Agent 架构详细报告 |
| [codex/architecture-learning-checklist.md](./codex/architecture-learning-checklist.md) | 值得学习的完整架构清单和检查项 |
| [codex/source-reading-map.md](./codex/source-reading-map.md) | 按调用链阅读 Codex 源码的地图 |
| [codex/current-project-gap-analysis.md](./codex/current-project-gap-analysis.md) | 当前项目能力、证据和缺口 |
| [codex/cloud-agent-mapping.md](./codex/cloud-agent-mapping.md) | 客户端 Codex 思想如何翻译为云端 NestJS Agent |
| [codex/terminology-map.md](./codex/terminology-map.md) | Codex、当前项目和中文助记名的概念对照 |

### 分阶段学习路线

| 文档 | 用途 |
| --- | --- |
| [learning-roadmap/README.md](./learning-roadmap/README.md) | 总路线、阶段依赖、学习顺序 |
| [learning-roadmap/progress-tracker.md](./learning-roadmap/progress-tracker.md) | 跨阶段进度与验收证据登记 |
| [learning-roadmap/learning-method.md](./learning-roadmap/learning-method.md) | 每个阶段统一采用的学习与 TDD 方法 |
| [learning-roadmap/checklist-phase-matrix.md](./learning-roadmap/checklist-phase-matrix.md) | 架构清单条目由哪个阶段建立、强化和收口 |

每个学习阶段都有独立目录，并固定包含：

- `README.md`：阶段目标、边界、架构设计和任务拆解。
- `source-reading.md`：Codex 与当前项目的源码阅读路径。
- `practice-and-acceptance.md`：练习、测试矩阵、验收证据和复盘问题。

## 推荐阅读路径

### 第一次阅读

1. [Codex 架构详细报告](./codex/architecture-report.md)
2. [当前项目差距分析](./codex/current-project-gap-analysis.md)
3. [云端架构映射](./codex/cloud-agent-mapping.md)
4. [学习路线总览](./learning-roadmap/README.md)
5. 当前阶段目录

### 准备实现某一阶段

1. 阅读阶段 `README.md`，先确认范围和不做什么。
2. 按 `source-reading.md` 沿一条真实调用链阅读。
3. 在 `practice-and-acceptance.md` 中先写 Red 验证，再做最小实现。
4. 把实现任务落到 `docs/tasks/`，不要直接把研究文档当任务单。

### 阶段收口

1. 用真实测试和运行结果填写验收证据。
2. 更新 [progress-tracker.md](./learning-roadmap/progress-tracker.md)。
3. 再同步 `docs/tasks/README.md`、`docs/roadmap.md` 和必要的工作记录。

## Research 与 Tasks 的边界

| 目录 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `docs/research/` | 研究结论、架构地图、长期学习路线 | 宣称当前代码已经实现 |
| `docs/tasks/` | 当前可执行任务、TDD 步骤和验收状态 | 存放长篇外部项目研究 |
| `docs/roadmap.md` | 项目阶段状态总览 | 展开每个架构主题的细节 |

研究路线可以比当前任务走得更远，但任何“已完成”都必须由当前代码、测试或运行结果证明。
