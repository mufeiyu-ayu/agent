# 学习证据追踪

本文件只记录学习者已经读过、能解释或亲自验证的证据，不记录当前 Agent 项目任务状态。空白是正常状态；不要因为研究文档已经写好而替学习者勾选。

## 状态与证据

状态只允许：`Not Started`、`Reading`、`Teach-back Ready`、`Experimented`。

| 模块 | 分类 | 状态 | 已读调用链/测试 | Teach-back 或实验链接 | 仍不确定的问题 |
| --- | --- | --- | --- | --- | --- |
| 00 测试与基线 | Core | Not Started | - | - | - |
| 01 模型事件 | Core | Not Started | - | - | - |
| 02 Tool Contract | Core | Not Started | - | - | - |
| 03 Tool Loop | Core | Not Started | - | - | - |
| 04 Tool 可靠性 | Core | Not Started | - | - | - |
| 05 HITL | Core | Not Started | - | - | - |
| 06 Context | Core | Not Started | - | - | - |
| 07 Durable Recovery | Advanced | Not Started | - | - | - |
| 08 并发 / Resume | Advanced | Not Started | - | - | - |
| 09 观测 / Eval / Tests | Advanced | Not Started | - | - | - |
| 10 云端安全 | Advanced | Not Started | - | - | - |
| 11 扩展体系 | Optional | Not Started | - | - | - |
| 12 Multi-agent | Optional | Not Started | - | - | - |
| 13 Capstone | Advanced | Not Started | - | - | - |

## 每次学习记录模板

```md
### YYYY-MM-DD — 模块 XX / 架构问题

- Codex 快照：ab6a7eb87cc8a816c88b86c44cf291e251ed2136
- 入口与调用链：
- 状态所有者：
- 副作用所有者：
- 正常测试：
- 失败/取消/恢复测试：
- 我能解释的不变量：
- TypeScript / Vue 类比：
- 小型实验（可选）：
- 当前项目是否需要：现在 / 触发后 / 不照搬
- 仍不确定：
```

## 核心 Teach-back 清单

- [ ] 不看文档画出 `turn/start → submission_loop → RegularTask → run_turn → ModelClientSession`。
- [ ] 解释 Thread、Turn、Task、Item、Event、Session、Step Context 的边界。
- [ ] 解释 ToolSpec、Router、Runtime、Registry、Handler、Orchestrator 为什么不能合并。
- [ ] 解释 call/output 配对、tool output 截断和 compaction 后的历史合法性。
- [ ] 解释 permission、approval、sandbox、exec policy 与 Guardian 的控制权。
- [ ] 解释 resume、fork、steer、interrupt 对 ID、历史与终态的不同影响。
- [ ] 解释实时 notification、durable rollout 和 UI state 为什么不是同一事实。

## Advanced / Optional Teach-back

- [ ] 说明 submission/tool/agent 三种并发限制分别解决什么问题。
- [ ] 说明 ExtensionRegistry 如何限制贡献面和保存 host 控制权。
- [ ] 区分 MCP、Skill、Plugin、Hook、App 与 Environment。
- [ ] 说明 child Thread 与工具并行的状态、成本和恢复差异。
- [ ] 指出 Codex 测试 harness 如何复现 provider、tool、cancel 与 recovery 顺序。

## 小型实验记录

实验不要求进入项目主分支。每个实验只验证一个问题：

| 日期 | 问题 | 最小输入 | 断言 | 结果 | 后续是否值得正式任务化 |
| --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | - |

## 更新规则

- “读过文件”不等于 `Teach-back Ready`；必须能讲清调用链、失败路径和不变量。
- `Experimented` 需要可复现命令、测试或最小代码，不要求生产实现。
- 项目代码是否已完成只能引用 `docs/tasks/**`，不能在这里推断。
- 源码更新后先核对完整 SHA；符号或语义变化时重新验证相关记录。
