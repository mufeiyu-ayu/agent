# Discussion Playbook：后续方案讨论如何借鉴 Codex

## 1. 默认决策流程

以后讨论 `agent` 项目任何 Agent Runtime 相关设计时，按这个流程：

```text
1. 先确认当前项目事实
2. 定位 codex-reference 对应专题
3. 提取 Codex 不变量
4. 删掉当前不需要的成熟复杂度
5. 给出 NestJS / Vue 最小方案
6. 写出测试和验收标准
7. 如需实现，再进入 Issue / PR 流程
```

## 2. 按问题查资料

| 问题 | 查阅文件 | 应重点提取 |
| --- | --- | --- |
| 怎么做单 Agent Tool Loop | `tool-loop.md`、`core-runtime.md` | needs_follow_up、call/output pairing、第二轮 sampling |
| 工具结果要不要展示给用户 | `context-history.md`、`tool-loop.md` | UI transcript 与 model history 分离 |
| 工具失败怎么办 | `tool-loop.md`、`durability-recovery.md` | observation failure vs runtime fatal |
| 如何避免无限工具调用 | `core-runtime.md`、`tool-loop.md` | loop bounds、samplingAttemptId、toolCallCount |
| 中断怎么处理 | `tool-loop.md`、`durability-recovery.md` | terminal exactly-once、late settlement |
| Context 太长怎么办 | `context-history.md` | observation budget、source priority、compaction 后置 |
| 写工具怎么保证安全 | `safety-permission.md`、`durability-recovery.md` | permission、approval、operation identity |
| 多实例/重启怎么恢复 | `durability-recovery.md` | durable facts、stale RUNNING、receipt |
| 是否要做 MCP | `extensibility-and-multi-agent.md` | 内置工具稳定前不做 |
| 是否要做 Multi-agent | `extensibility-and-multi-agent.md` | child Thread 成本和边界 |

## 3. 方案讨论输出模板

```md
## 推荐方案

用一句话说明当前最小方案。

## 当前项目事实

列出现有代码、测试和缺口。

## Codex 参考

列出对应源码设计和不变量，不要逐文件摘要。

## 迁移判断

- 直接迁移什么。
- 简化迁移什么。
- 暂时不迁移什么。

## 前端需要做什么

Vue / Nuxt / Chat UI / streaming / timeline / approval UI。

## 后端需要做什么

NestJS service、types、Prisma、测试、错误收口。

## LLM / Agent 需要做什么

prompt、model event、tool call、observation、context。

## 测试和验收

列 Red-Green-Refactor 和必要测试。
```

## 4. 当前阶段优先级

### P0：近期必须完成

- 单 Agent Tool Loop。
- ModelInputItem / provider request mapper。
- observation 回填。
- 第二轮 sampling 测试。
- tool call 不污染 UI Message。
- abort / invalid / unknown / loop limit 测试。

### P1：近中期

- Tool execution record。
- timeout / cancel / error taxonomy。
- observation truncation。
- context budget interface。
- sync endpoint 与 stream endpoint 统一 runner。
- Run/Step timeline 查询。

### P2：中后期

- HITL approval。
- user / tenant ownership。
- idempotency / operation receipt。
- stale RUNNING recovery。
- eval / observability。

### P3：只作为参考

- MCP。
- Plugin / Skill。
- Goal。
- Memory。
- Multi-agent。
- Remote exec。

## 5. 任务转化规则

一个 Codex 设计只有满足以下条件，才应进入正式 Issue：

1. 当前项目存在同类真实约束。
2. 可以切成一个明确 task。
3. 有最小测试能证明不变量。
4. 不依赖尚未完成的前置能力。
5. 不会顺手推进多个阶段。

例子：

```text
Codex ToolCallRuntime 很复杂
  -> 当前只迁移 terminal exactly-once 的思想
  -> 任务切成“abort tool 后不启动下一轮 sampling”
  -> 不实现并行工具和 hook
```

## 6. 给 GPT 的自检清单

每次引用本知识库时，GPT 应自检：

- 有没有把 Codex 源码事实和迁移建议混写？
- 有没有把旧 research 的过期当前项目状态当真？
- 有没有建议当前阶段不该做的高级能力？
- 有没有说明哪些东西现在可以先不用学？
- 有没有给出 TypeScript / NestJS 可落地边界？
- 有没有给出测试标准？
