# Agent 架构研究资料

本目录保存源码研究、设计对照与学习记录。**当前主要参照是 [Pi 参考知识库](./pi-reference/README.md)**：为用户完成当前 agent 源码学习后、由 AI 实现云端 Agent 准备的参照素材；用户不读 Pi 代码。

研究资料不承担正式任务看板；实时状态以 [`../tasks/README.md`](../tasks/README.md) 为准。研究完成不自动启动重构。

## 顶层结构与读取边界

```text
research/
├── README.md                                   现行总入口
├── pi-reference/                               Pi 研究、源码标注、图表、参照实现方法与实现路线
├── workbench-direction.md                      工作台方向、路线与触发（两期、上云、gsc 延后）
├── context-management.md                       上下文管理技术讨论：工具记录、压缩、步数上限（2026-09-28 起）
├── configuration-map.md                        当前项目配置导航
└── phase-08-grounded-answer-citation-design.md  Phase 8 历史设计依据（对应能力已删除）
```

实现智能体从 `pi-reference/README.md` 按问题选资料。研究、参照方法与每步素材都在 `pi-reference/`，实现顺序在 `workbench-direction.md` 第 7 节；旧Codex研究体系已删除。

## 从这里开始

| 需要 | 入口 |
| --- | --- |
| 产品方向、档与触发（唯一的顺序来源）、gsc 延后边界与否决项 | [workbench-direction.md](./workbench-direction.md) |
| 新会话理解研究目的、目录与阅读顺序 | [pi-reference/README.md](./pi-reference/README.md) |
| AI 实现前怎样查证据、怎样向用户汇报 | [how-to-read.md](./pi-reference/how-to-read.md) |
| Pi 架构思想、文件夹与处理风格 | [architecture-and-style.md](./pi-reference/architecture-and-style.md) |
| 原码索引、注释、真实调用链 | Pi 入口的主题路由 → `modules/` |
| 交互架构、流程与时序图 | [图集入口](./pi-reference/diagrams/index.html) · [维护说明](./pi-reference/diagrams/README.md) |
| 对照我们的现有能力和缺口 | [current-agent-mapping.md](./pi-reference/current-agent-mapping.md) |
| 每步 Pi 素材与证明完成（顺序看工作台方向第 7 节） | [Pi roadmap](./pi-reference/roadmap.md) |
| 核实版本、全仓覆盖与验证范围 | [source-snapshot](./pi-reference/source-snapshot.md)、[coverage](./pi-reference/coverage.md)、[verification](./pi-reference/verification.md) |

## 项目配套资料

| 资料 | 定位 |
| --- | --- |
| [Grounded Answer / Citation 设计](./phase-08-grounded-answer-citation-design.md) | Phase 8 的历史研究；RAG / Grounding 已删除，不作为当前源码入口或功能规格 |
| [上下文管理](./context-management.md) | E1（#218）/ E3（#220）的技术讨论：现状、opencode / Claude / Codex / Pi 等参照、步数上限对照、共识与待讨论问题 |
| [配置地图](./configuration-map.md) | 当前配置职责导航；具体默认值以源码和生效入口核对 |
| [参照实现方法](./pi-reference/learning-method.md) | 每步六问、产物与防过度设计 |
| DeepSeek Harness | 补充参照；本机 `/Users/ayu/Desktop/deepseek-harness`，另见 [上游仓库](https://github.com/deepseek-ai/deepseek-harness)；继续引用前先核对实际版本 |

## 研究转为正式任务的条件

先证明真实问题、当前前置能力、最小范围与可验收场景，再由用户定案并进入仓库 Issue/PR 流程。Pi 有某项机制，不意味着我们必须立即实现。

| 位置 | 责任 |
| --- | --- |
| 当前代码、测试、PR head 与验证输出 | 能力与实现事实 |
| 最新 Issue 正文 | 实现规格、验收标准与已确认决策 |
| `docs/tasks/README.md` | 正式任务状态；逐条验收证据在 PR |
| `docs/roadmap.md` | 阶段路线、方向定案与后置清单 |
| `docs/research/**` | 研究证据、解释、候选方向 |
| `docs/work-log.md` | 已发生事实 |

发生冲突时，先区分“当前事实”“当时快照”“未来建议”，再核对原始代码与用户本次目标，不沿用过期状态。
