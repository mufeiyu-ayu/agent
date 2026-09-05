# GitHub 学习开发工作流规范（GPT + Codex 双角色流程）

本文固定 GPT、GitHub Issue、本地 Codex、Pull Request、Codex Review、学习 docs 与用户授权执行之间的协作边界，只在使用 Codex + GPT 时生效。`AGENTS.md` 保存触发规则和硬约束，本文保存完整流程。使用 Claude 时以 `CLAUDE.md` 的单角色流程为准，本文不适用。

## 1. 工作方式

### 自由讨论 / inspection 模式

没有命中明确触发语时，GPT 或 Codex 只做学习讨论、代码阅读、方案设计、本地实验或小改动建议。

默认不创建 Issue、不切任务分支、不 commit、不 push、不创建 PR、不更新 task / roadmap / work-log 状态。用户可以继续讨论，也可以把讨论升级为 docs 沉淀、正式 Issue 或轻量 PR。

### 正式 Issue 模式

适合功能、修复、重构、数据库、API、Agent Runtime、Tool Calling、权限、正式任务状态和阶段收口。

| 用户表达 | 默认执行者 | 默认完成点 |
| --- | --- | --- |
| “完成 Issue #N”“读取 Issue #N 并实现” | 本地 Codex | Draft PR、Review、验证结果、学习交接；状态为已实现、待验收 |
| “处理 PR #N 的 Review” | 本地 Codex | 解释 findings；用户确认后修复并 push 原 PR |
| “GPT 已确认 Issue #N 验收通过，我也确认通过，请收口” | Codex 或 GPT | 更新允许范围内的正式任务状态 |
| “将 PR #N 转 Ready 并合并、清理分支” | Codex 或 GPT | 按授权转 Ready、合并、删除远程分支；本地清理由 Codex / 用户完成 |

正式 Issue 与 task 文档存在会改变实现方向的冲突时，必须由用户决定。一个 Issue 只对应一个任务单元，不顺手推进后续 Task。

### GPT 学习路线与 docs 沉淀模式

适用于学习路线、阶段目标、技术方案、架构理解、项目复盘和作品集沉淀。

执行方式：

```text
用户与 GPT 讨论学习内容
-> GPT 总结可写入 docs 的内容
-> 用户确认沉淀
-> GPT 更新允许范围内的 docs-only 内容
-> 用户明确授权时可直接提交 master；否则使用轻量 docs 分支 / PR
```

推荐写入位置：

- 长期学习路线、研究材料、学习笔记：`docs/research/**`。
- 当前阶段任务边界：`docs/tasks/**`，需要用户明确确认。
- 项目阶段路线：`docs/roadmap.md`，不得未经授权推进状态。
- 真实发生的项目记录：`docs/work-log.md`，只写 commit 级事实。

学习 docs 沉淀不强制创建 Issue。只有当计划转成正式功能、修复、重构、数据库、API、Agent Runtime、Tool Calling 或权限任务时，才进入正式 Issue 模式。

### GPT 受托实现模式

正式功能默认仍由本地 Codex 按 Issue 实现。GPT 负责需求讨论、任务拆分、Issue、交接 Prompt 和最终验收；除非项目规范另有明确授权，不用 GPT 直接替代 Codex 实现正式功能代码。

### GPT / Codex 受托收口模式

用户拥有最终决定权，可以把执行动作委托给 GPT 或 Codex。

GPT 可以在用户明确授权后执行：

- 收口已经由 GPT 技术验收、且用户明确确认通过的正式任务 docs 状态；
- 将已验收 Draft PR 转为 Ready；
- 远程合并已明确授权合并的 PR；
- 关闭用户确认放弃的 PR；
- 删除已合并 PR 的远程分支；
- 在 GitHub 上补充验收或收口说明。

Codex / 用户本地负责：

- 同步本地 `master`；
- 清理本地 issue 分支；
- 处理本地未提交工作区；
- 继续执行需要本地验证或本地环境的工作。

### 明确授权的 docs 直接 master 模式

用户明确授权 GPT “更新 docs 并写入 master”“直接改 docs”“收口任务状态”或含义等价的指令时，允许范围内的 docs-only 变更可以直接提交 `master`，不为文档修改单独创建 Issue 或 PR。

允许范围包括：

- `README.md`、`docs/README.md` 的项目进度和入口说明；
- `docs/research/**` 的学习路线、研究材料、架构分析和复盘；
- `docs/tasks/**` 的规划、Next / Active / 已实现 / 待验收 / Completed 状态同步和归档；
- `docs/roadmap.md` 的阶段顺序和状态同步；
- `docs/work-log.md` 已真实发生事项的记录；
- 协作规范、开发流程、typo、格式和纯 Markdown 调整。

以下改动不得使用该捷径：

- 功能行为、API 或 shared contracts；
- 数据库、migration 或 seed；
- Agent Runtime、Streaming、Tool Calling；
- 依赖、环境变量、安全或权限；
- 前后端业务代码与测试代码；
- 任何虽然是 Markdown、但会影响运行时行为的生成规格或策略。

## 2. 角色与事实来源

| 角色 | 职责 |
| --- | --- |
| GPT | 讨论需求、制定学习路线、沉淀 docs、拆分任务、创建 Issue、生成 Codex 开工 Prompt、验收 PR；用户授权后可收口 docs、转 Ready、远程合并 PR、关闭放弃 PR、删除远程分支 |
| `docs/tasks/**` | 保存任务边界和正式状态，是项目事实来源 |
| `docs/research/**` | 保存学习路线、研究材料、方案草案和复盘沉淀 |
| GitHub Issue | 保存一次准备实施的任务规格、验收标准及澄清与决策记录 |
| 本地 Codex | 读取 Issue、执行 Clarification Gate、创建分支、实现、验证、提交、Draft PR、Review 修复、本地同步和本地分支清理 |
| 云端 Codex Review | PR 创建后独立检查实现正确性、边界、回归风险和安全问题 |
| 用户 | 最终确认需求取舍、验收、任务收口、Draft 转 Ready、合并、关闭、分支清理和开始下一任务；可将执行动作委托给 GPT 或 Codex |

事实来源顺序：

1. 当前代码、Issue、PR、Review、commit 和 CI 以 GitHub 实时状态为准；
2. 最新 Issue 正文与用户确认的澄清与决策记录共同构成本 Task 的实现规格；
3. 正式任务状态以 `docs/tasks/**` 为准；
4. 完整开发工作流以本文为准；
5. 路线总览以 `docs/roadmap.md` 为准；
6. 真实发生的项目记录写入 `docs/work-log.md`；
7. 学习和研究材料优先写入 `docs/research/**`。

用户最新明确决定高于已有假设。Issue、`docs/tasks/**`、本文、当前代码或用户最新决定发生会影响正式实现的冲突时，停止实现，由 GPT 明确冲突并同步规格后重新执行 Gate。

## 3. GPT 创建 Issue 与正式交接

Issue 至少应包含：

```md
## 任务类型

feature / fix / refactor / docs-task / phase-closeout / research

## 目标

## 当前代码事实

## 实现范围

## 不在本任务范围

## 边界与失败行为

## 验收标准

## 学习重点

## 需要同步的项目文档

## 相关任务文档

## 澄清与决策记录
```

一个 Issue 只对应一个任务单元。Issue 不应顺手包含下一阶段、下一 Task 或无关优化。

Issue 创建完成只表示任务规格已建立，不表示已经完成向 Codex 的交接。GPT 必须同时提供任务专属 Codex 开工 Prompt，明确：

- 需要读取的 Issue、`docs/tasks/**`、相关代码、schema、契约和测试；
- 本 Task 的高风险决策点、兼容风险和长链路集成点；
- Gate 为 `READY` / `BLOCKED` 时分别如何处理；
- Draft PR、验证、状态和收口限制。

## 4. Clarification Gate 与本地 Codex 实现 Issue

Codex 修改代码前必须先读取 Issue 最新正文 / 评论、对应 `docs/tasks/**`、本文、相关代码、公共类型、数据库 schema、API 契约和测试，并输出开发前确认。

推荐结构：

```text
Gate 结论：READY / BLOCKED
已确认需求：R-xx
当前假设：A-xx
阻塞性歧义：Q-xx
边界情况：E-xx
不在本次范围：N-xx
验收映射计划：AC-xx -> 实现位置 -> 验证方式
```

Gate 决策规则：

- Issue、代码和规范已经给出唯一答案时，直接 `READY`，不得为了展示流程制造问题；
- `BLOCKED` 时立即停止，不创建实现分支、commit 或 PR，不修改正式任务状态；
- 阻塞问题由 GPT 压缩成真正需要决策的事项，用户确认后回写 Issue / docs，再重新 Gate；
- 非阻塞的内部实现选择可遵循现有项目惯例，但必须记录为假设；
- 开发过程中若发现新的阻塞性歧义，停止相关实现并重新返回 `BLOCKED`。

Gate 为 `READY` 后：

```text
读取最新 Issue / task / master
  -> 创建 codex/issue-N-* 独立分支
  -> 按验收映射实现
  -> 运行必要验证
  -> 记录实现证据：已实现、待验收
  -> commit
  -> push
  -> 创建 Draft PR
  -> Codex Review
  -> GPT 技术验收
  -> 用户确认验收
  -> docs 状态收口
  -> 用户明确授权 Draft 转 Ready / 合并 / 分支清理
```

实现阶段可以更新 checklist、验证结果和交付链接，但不得：

- 把任务或阶段标记为 Completed；
- 自行宣称 GPT 或用户验收通过；
- 自行将 Draft 转 Ready；
- 自行合并 PR 或删除分支；
- 推进下一任务或把 roadmap 写成已完成；
- 把 Codex 自己的实现判断当成最终验收结论。

Codex 实现完成后的正式状态最多为：

```text
实施状态：已实现
验收状态：待验收
```

## 5. 双状态模型

正式任务同时记录两个维度：

| 维度 | 可用状态 |
| --- | --- |
| 实施状态 | 未开始 / 进行中 / 已实现 |
| 验收状态 | 未验收 / 待验收 / 需要修改 / 已通过 |

只有“实施状态：已实现”且“验收状态：已通过”时，任务才可以进入 Completed；其中“已通过”必须有 GPT 基于最新 PR / commit 的技术验收和用户明确确认。

## 6. Review 修复

Draft PR 可以接受云端 Codex Review 和 GPT 验收，不需要先转 Ready。

```text
读取未解决 Review findings
  -> 判断 finding 是否属于当前 Issue
  -> 解释触发场景、影响和建议修复
  -> 按当前授权修复范围内问题
  -> 在原 PR 分支运行受影响验证
  -> commit
  -> push 原 Draft PR
  -> 功能代码或重要边界有变化时请求复审
  -> 保持已实现、待验收
```

- 范围内问题按授权修复；
- 超出范围的问题记录为后续 Task，不顺手扩项；
- 修复如果改变 API、数据、权限、交互或验收标准，必须先更新规格并重新 Gate；
- 禁止本地和云端同时修改同一 PR；云端 push 后，本地继续工作前必须同步远程分支。

## 7. GPT 与用户验收

Review 问题处理完后，GPT 至少结合以下证据给出技术验收结论：

- Issue 最新规格和澄清决策；
- PR 最新 head commit 与 diff；
- 每条验收标准的通过 / 失败 / 未验证状态；
- Codex Review findings 及处理结果；
- 验证命令、环境和真实结果；
- 边界、失败路径和长链路集成；
- 剩余风险或后续 Task。

代码“看起来合理”或测试命令返回成功都不能单独构成完整验收证据。

GPT 技术验收通过后，仍需用户明确确认验收。只有用户确认后，GPT（或用户指定的 Codex）才能把任务状态收口为“验收已通过”或 Completed。

状态收口不等于 Draft 转 Ready 或合并授权。用户可以在同一句指令中一并授权，但没有明确授权时不得自动推导。

## 8. 合并与分支处理

合并前必须满足：

- GPT 已基于 PR 最新 commit 给出技术验收通过结论；
- 用户已明确确认验收；
- 用户已明确授权 Draft 转 Ready 和合并；
- PR base 是 `master`；
- PR 已按授权从 Draft 转为 Ready；
- 没有未处理的 P0 / P1 Review finding，或被用户明确接受为非阻塞风险；
- 验收标准均有验证证据；
- 合并不会推进未授权的下一任务。

GPT 远程合并流程：

```text
确认 PR 最新 head SHA 与验收状态
  -> 按用户授权将 Draft 转 Ready
  -> 合并到 master
  -> 确认 PR merged
  -> 删除已合并 PR 的远程分支，或说明当前连接器无法删除
  -> 汇报本地 master 和本地分支仍需用户 / Codex 同步
```

Codex 本地合并流程：

```text
确认 PR 最新 head SHA、验收状态和用户授权
  -> 将 Draft 转 Ready
  -> 合并到 master
  -> fast-forward 同步本地 master
  -> 确认合并内容已落入主分支
  -> 删除远程 Issue 分支
  -> 安全删除本地 Issue 分支
```

PR 若仍为 Draft且没有转 Ready 授权，停止合并。放弃任务的 PR / 分支只有用户确认后才关闭或删除。PR 描述使用 `Closes #N` 时，Issue 会在 PR 合并后自动关闭。

## 9. ChatGPT 直接修改远程仓库

连接 GitHub 后，GPT 可以按本规范执行远程 Issue、docs、PR 验收和收尾动作。

- 允许范围内的 docs-only 变更在用户明确授权后可以直接提交 `master`；
- 正式功能默认仍由 Codex 按 Issue 实现，不使用 docs 直写模式绕过正式开发流程；
- GPT 的远程修改不会自动出现在用户本地；本地继续工作前需要同步远程；
- 当前连接器如果不支持某项远程分支清理动作，GPT 需要明确说明，不能假装已完成。

## 10. 当前仓库约定

- 主分支：`master`。
- Issue 分支：`codex/issue-<number>-<short-slug>`。
- GPT 轻量 docs 分支：`docs/<short-slug>`（仅在不使用授权的 docs 直写模式时需要）。
- 一个 Issue 对应一个任务单元和一个 PR。
- 正式功能 PR 默认以 Draft 创建，目标分支为 `master`。
- Draft PR 可以接受 Review 和 GPT 技术验收；只有用户明确授权后才转 Ready、合并和清理分支。
- 当前仓库未配置 GitHub Actions，也没有部署流程；不把 CI 当成当前必经步骤。
- Codex Review 与本地验证是当前主要质量检查。