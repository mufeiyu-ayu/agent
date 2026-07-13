# GitHub 学习开发工作流规范

本文固定 GPT、GitHub Issue、本地 Codex、Pull Request、Codex Review、学习 docs 与用户授权执行之间的协作边界。`AGENTS.md` 保存触发规则和硬约束，本文保存完整流程。

## 1. 工作方式

### 自由讨论 / inspection 模式

没有命中明确触发语时，GPT 或 Codex 只做学习讨论、代码阅读、方案设计、本地实验或小改动建议。

默认不创建 Issue、不切任务分支、不 commit、不 push、不创建 PR、不更新 task / roadmap / work-log 状态。用户可以继续讨论，也可以把讨论升级为 docs 沉淀、正式 Issue 或轻量 PR。

### 正式 Issue 模式

适合功能、修复、重构、数据库、API、Agent Runtime、Tool Calling、权限、正式任务状态和阶段收口。

| 用户表达 | 默认执行者 | 默认完成点 |
| --- | --- | --- |
| “完成 Issue #N”“读取 Issue #N 并实现” | 本地 Codex | Ready PR、自动 Review、验证结果、学习交接；状态为已实现、待验收 |
| “处理 PR #N 的 Review” | 本地 Codex | 解释 findings；用户确认后修复并 push 原 PR |
| “GPT 已确认 Issue #N 验收通过，我也确认通过，请收口” | Codex 或 GPT | 更新允许范围内的正式任务状态 |
| “合并 PR #N 并清理分支” | Codex 或 GPT | 按授权合并、删除远程分支；本地清理由 Codex / 用户完成 |

正式 Issue 与 task 文档存在会改变实现方向的冲突时，必须由用户决定。一个 Issue 只对应一个任务单元，不顺手推进后续 Task。

### GPT 学习路线与 docs 沉淀模式

适用于学习路线、阶段目标、技术方案、架构理解、项目复盘和作品集沉淀。

执行方式：

```text
用户与 GPT 讨论学习内容
-> GPT 总结可写入 docs 的内容
-> 用户确认沉淀
-> GPT 通过轻量分支更新 docs
-> 创建 Ready PR，或在用户明确授权时直接提交允许的 docs-only 改动
```

推荐写入位置：

- 长期学习路线、研究材料、学习笔记：`docs/research/**`。
- 当前阶段任务边界：`docs/tasks/**`，需要用户明确确认。
- 项目阶段路线：`docs/roadmap.md`，不得未经授权推进状态。
- 真实发生的项目记录：`docs/work-log.md`，只写 commit 级事实。

学习 docs 沉淀不强制创建 Issue。只有当计划转成正式功能、修复、重构、数据库、API、Agent Runtime、Tool Calling 或权限任务时，才进入正式 Issue 模式。

### GPT 受托实现模式

当用户明确说“你直接实现”“你来改项目”“不用 Codex”时，GPT 可以通过 GitHub 连接器创建远程分支、修改文件、commit 并创建 Ready PR。

默认规则：

- 正式功能仍使用独立分支和 PR，不直接提交 `master`。
- 修改范围必须按用户授权保持最小。
- 业务代码、API、数据库、Agent Runtime、Tool Calling、权限改动必须写清影响范围、验证方式和剩余风险。
- Ready PR 不代表验收通过或允许合并。
- 合并仍需要用户明确授权；用户也可以提前授权“如果你验收通过就合并”。

### GPT / Codex 受托收口模式

用户拥有最终决定权，可以把执行动作委托给 GPT 或 Codex。

GPT 可以在用户明确授权后执行：

- 远程合并已验收通过的 Ready PR；
- 关闭用户确认放弃的 PR；
- 删除已合并 PR 的远程分支；
- 在 GitHub 上补充验收或收口说明。

Codex / 用户本地负责：

- 同步本地 `master`；
- 清理本地 issue 分支；
- 处理本地未提交工作区；
- 继续执行需要本地验证或本地环境的工作。

### 明确授权的直接 master 模式

用户明确说“直接在 master 提交并 push”时，低风险 typo、文案、样式微调和不改变正式状态的普通 docs 修正可以绕过 Issue / PR。

以下改动不得使用该捷径：

- 功能行为、API 或 shared contracts；
- 数据库、migration 或 seed；
- Agent Runtime、Streaming、Tool Calling；
- 依赖、环境变量、安全或权限；
- 正式 task / roadmap 状态和阶段归档；
- 影响范围无法确定的改动。

## 2. 角色与事实来源

| 角色 | 职责 |
| --- | --- |
| GPT | 讨论需求、制定学习路线、沉淀 docs、拆分任务、创建 Issue、验收 PR；用户授权后可远程合并 PR、关闭放弃 PR、删除远程分支 |
| `docs/tasks/**` | 保存任务边界和正式状态，是项目事实来源 |
| `docs/research/**` | 保存学习路线、研究材料、方案草案和复盘沉淀 |
| GitHub Issue | 保存一次准备实施的任务快照，并引用 task 文档 |
| 本地 Codex | 读取 Issue、创建分支、实现、验证、提交、Ready PR、Review 修复、本地同步和本地分支清理 |
| 云端 Codex Review | PR 创建后自动检查高风险问题 |
| 用户 | 最终确认验收、修复范围、合并、关闭、分支清理和开始下一任务；可将执行动作委托给 GPT 或 Codex |

GPT 的验收意见不是自动写状态或自动合并授权；只有用户明确确认或提前授权时，才执行对应收口动作。

## 3. GPT 创建 Issue

Issue 建议包含：

```md
## 任务类型

feature / fix / refactor / docs-task / phase-closeout / research

## 目标

## 实现范围

## 不在本任务范围

## 验收标准

## 学习重点

## 需要同步的项目文档

## 相关任务文档
```

一个 Issue 只对应一个任务单元。Issue 不应顺手包含下一阶段、下一 Task 或无关优化。

## 4. 本地 Codex 实现 Issue

```text
读取 Issue、task 文档和相邻代码
  -> 同步 master
  -> 创建 codex/issue-N-* 分支
  -> 实现代码或文档
  -> 运行最小必要验证
  -> 记录实现证据：已实现、待验收
  -> commit
  -> push
  -> 创建 Ready PR
  -> 自动 Codex Review
  -> 学习交接
```

“完成 Issue #N”默认授权到 Ready PR，但不授权合并或最终任务收口。Ready 只表示 PR 可以接受 Review，不表示验收通过或允许合并。

实现阶段可以更新 checklist、验证结果和交付链接，但不得：

- 把任务或阶段标记为 Completed；
- 推进下一任务或把 roadmap 写成已完成；
- 归档阶段；
- 把 Codex 自己的实现判断当成最终验收结论。

只有实现完成且必要验证通过后，才能把任务文档更新为“实施状态：已实现、验收状态：待验收”。实现未完成、验证失败、任务受阻或等待用户确认时使用 Draft，保留原任务状态并记录阻塞原因。

Draft 恢复顺序：

```text
完成实现
  -> 通过必要验证
  -> 更新为已实现、待验收
  -> 转为 Ready
  -> 自动 Codex Review
  -> GPT 与用户验收
```

## 5. 双状态模型

正式任务同时记录两个维度：

| 维度 | 可用状态 |
| --- | --- |
| 实施状态 | 未开始 / 进行中 / 已实现 |
| 验收状态 | 未验收 / 待验收 / 需要修改 / 已通过 |

只有“实施状态：已实现”且“验收状态：已通过”时，任务才可以进入 Completed。

## 6. Review 修复

PR 创建后，Codex Review 的问题在 GitHub PR 页面查看。当前主流程不要求 GitHub Actions；验证以本地最小必要检查为准。

```text
读取未解决 Review findings
  -> 解释触发场景、影响和建议修复
  -> 等待用户确认修复范围
  -> 在原 PR 分支本地修复
  -> 运行受影响验证
  -> commit
  -> push 原 PR
  -> 功能代码或重要边界有变化时使用 @codex review 复审
  -> 保持原有 Draft / Ready 状态和任务验收状态
```

commit、push 和 Review trigger 是独立动作。Ready PR 创建后优先依靠自动 Review；仅在自动审核未触发，或功能代码、重要边界修复后需要复审时手动触发。只有回复、resolve thread 或 docs 收口时，不重复触发 Review。

只有用户明确选择时才允许云端修复。禁止本地和云端同时修改同一 PR；云端 push 后，本地继续工作前必须同步远程分支。

## 7. GPT 与用户验收

Review 问题处理完后，GPT 结合以下信息给出验收意见：

- Issue 目标和验收标准；
- PR diff；
- Codex Review findings 及处理结果；
- 本地验证结果；
- 用户对关键调用链和设计边界的学习确认。

如果 GPT 认为需要修改，用户可让本地 Codex、云端 Codex 或 GPT 继续处理。GPT 认为通过后，用户可以选择：

```text
GPT 已确认 Issue #N 验收通过，我也确认通过，请收口任务状态。
```

或：

```text
如果你验收通过，就直接收口、合并 PR #N，并删除远程分支。
```

状态收口不等于合并授权，除非用户同时明确授权。

## 8. 合并与分支处理

合并前必须满足：

- GPT 已给出验收通过结论，或用户已明确接受当前 PR；
- 用户已明确授权合并；
- PR base 是 `master`；
- PR 不是 Draft；
- 没有未处理的 P0 / P1 Review finding；
- 验证失败项若存在，已明确为既有基线或用户接受的非阻塞问题；
- 合并不会推进未授权的任务状态或下一任务。

GPT 远程合并流程：

```text
确认 PR 状态和 head SHA
  -> 合并到 master
  -> 确认 PR merged
  -> 删除已合并 PR 的远程分支，或说明当前连接器无法删除
  -> 汇报本地 master 和本地分支仍需用户 / Codex 同步
```

Codex 本地合并流程：

```text
确认 PR 和验收状态
  -> 合并到 master
  -> fast-forward 同步本地 master
  -> 确认合并内容已落入主分支
  -> 删除远程 Issue 分支
  -> 安全删除本地 Issue 分支
```

PR 若仍为 Draft，停止合并并返回实现流程。放弃任务的 PR / 分支只有用户确认后才关闭或删除。PR 描述使用 `Closes #N` 时，Issue 会在 PR 合并后自动关闭。

## 9. ChatGPT 直接修改远程仓库

连接 GitHub 后，GPT 可以直接创建远程分支、commit 和 PR，不需要 Codex Cloud。

- 正式任务状态、roadmap、`AGENTS.md` 或 skills 变更：优先轻量分支和 Ready PR；是否创建 Issue 由用户决定。
- 普通研究草稿、学习资料、文案或 typo，且不改变正式状态：可以不建 Issue，直接创建远程分支和 PR。
- GPT 的远程修改不会自动出现在本地；本地继续工作前需要同步远程。
- 当前连接器如果不支持删除远程分支，GPT 需要明确说明，不能假装已完成。

## 10. 当前仓库约定

- 主分支：`master`。
- Issue 分支：`codex/issue-<number>-<short-slug>`。
- GPT 轻量 docs 分支：`docs/<short-slug>`。
- 一个 Issue 对应一个任务单元和一个 PR。
- PR 默认以 Ready 创建，目标分支为 `master`；Draft 仅用于实现未完成、验证失败、任务受阻或等待用户确认。
- 当前仓库未配置 GitHub Actions，也没有部署流程；不把 CI 当成当前必经步骤。
- 自动 Codex Review 与本地验证是当前主要质量检查。
