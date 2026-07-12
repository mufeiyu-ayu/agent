# GitHub 学习开发工作流规范

本文固定 GPT、GitHub Issue、本地 Codex、Pull Request、Codex Review 与用户验收之间的协作边界。`AGENTS.md` 只保存触发规则和硬约束，具体执行步骤由项目 skill 负责。

## 1. 三种工作方式

### 自由模式

没有命中明确触发语时，Codex 按普通本地协作处理：

- 可以学习代码、讨论方案、检查实现、做本地实验或小改动；
- 默认不创建 Issue、不切任务分支、不 commit、不 push、不创建 PR；
- 默认不更新 task、roadmap 或阶段状态；
- 用户可以继续讨论，也可以把改动升级为正式 Issue。

### 正式 Issue 模式

适合功能、修复、重构、正式任务计划和阶段状态变更：

| 用户表达 | Skill | 默认完成点 |
| --- | --- | --- |
| “完成 Issue #N”“读取 Issue #N 并实现” | `github-issue-workflow` | Ready PR、自动 Review、验证结果、学习交接；状态为已实现、待验收 |
| “处理 PR #N 的 Review” | `github-pr-review-fix` | 解释 findings；用户确认后修复并 push 原 PR |
| “GPT 已确认 Issue #N 验收通过，我也确认通过，请收口” | `github-issue-workflow` | 更新正式任务状态并 push 原 PR |
| “合并 PR #N 并清理分支” | `github-issue-workflow` | 合并、同步 master、安全清理分支 |

### 明确授权的直接 master 模式

用户明确说“直接在 master 提交并 push”时，低风险 typo、文案、样式微调和不改变正式状态的普通 docs 修正可以绕过 Issue / PR。Codex 仍需先同步 `master`、检查改动、运行最小验证，再 commit 和 push。

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
| GPT | 与用户讨论需求、拆分任务、创建 Issue；实现后结合 PR、Review 和验证给出验收意见 |
| `docs/tasks/**` | 保存学习路线、任务边界和正式状态，是项目事实来源 |
| GitHub Issue | 保存一次准备实施的任务快照，并引用 task 文档 |
| 本地 Codex | 读取 Issue、创建分支、实现、验证、提交、Ready PR、Review 修复和学习交接 |
| 云端 Codex Review | PR 创建后自动检查高风险问题 |
| 用户 | 最终确认验收、修复范围、合并和分支清理 |

GPT 的验收意见不是自动写状态的授权；只有用户明确确认后，本地 Codex 才收口正式状态。

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

Issue 与 task 文档存在会改变实现方向的冲突时，必须由用户决定。一个 Issue 只对应一个任务单元，不顺手推进后续 Task。

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

“完成 Issue #N”默认授权到 Ready PR，但不授权合并或最终任务收口。Ready 只表示 PR 可以接受 Review，不表示验收通过或允许合并。实现阶段可以更新 checklist、验证结果和交付链接，但不得：

- 把任务或阶段标记为 Completed；
- 推进下一任务或把 roadmap 写成已完成；
- 归档阶段；
- 把 Codex 自己的实现判断当成最终验收结论。

只有实现完成且必要验证通过后，才能把任务文档更新为“实施状态：已实现、验收状态：待验收”。实现未完成、验证失败、任务受阻或等待用户确认时使用 Draft，保留原任务状态并记录阻塞原因，不得进入 GPT 验收。Draft 恢复后按以下顺序继续：

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

commit、push 和 Review trigger 是三个独立动作：commit 只记录本地变更，push 只更新远程分支，`@codex review` 只请求复审。Ready PR 创建后优先依靠自动 Review；仅在自动审核未触发，或功能代码、重要边界修复后需要复审时手动触发。只有回复、resolve thread 或 docs 收口时，不重复触发 Review。

只有用户明确选择时才允许云端修复，例如 `@codex fix the P1 issue`。禁止本地和云端同时修改同一 PR；云端 push 后，本地继续工作前必须同步远程分支。

GitHub Actions 可在项目以后需要自动化验证或部署时再配置，不作为当前流程的阻塞条件。

## 7. GPT 与用户验收

Review 问题处理完后，GPT 结合以下信息给出验收意见：

- Issue 目标和验收标准；
- PR diff；
- Codex Review findings 及处理结果；
- 本地验证结果；
- 用户对关键调用链和设计边界的学习确认。

如果 GPT 认为需要修改，用户让本地 Codex 继续处理 PR。GPT 认为通过后，用户仍需明确说：

> GPT 已确认 Issue #N 验收通过，我也确认通过，请收口任务状态。

此时 Codex 才能在原 PR 分支更新：

- 对应 `docs/tasks/**` 的验收状态和最终 checklist；
- `docs/tasks/README.md` 与 `docs/roadmap.md` 的阶段状态；
- 完成阶段所需的 `docs/tasks/completed/` 归档；
- 必要的 `docs/work-log.md` commit 级记录。

状态收口不等于授权合并。除非用户同时明确授权，PR 继续保持 Ready。

## 8. 合并与分支处理

只有任务已经是“验收状态：已通过”且用户明确授权合并后：

```text
确认 PR 和验收状态
  -> 合并到 master
  -> fast-forward 同步本地 master
  -> 确认合并内容已落入主分支
  -> 删除远程 Issue 分支
  -> 安全删除本地 Issue 分支
```

- 正常 Ready PR 合并时不需要状态转换。
- PR 若仍为 Draft，停止合并并返回实现流程；不得从 Draft 直接合并。
- 未合并分支继续保留。
- 放弃任务的分支只有用户确认后才删除。
- 不强制删除未合并的本地分支；安全删除失败时停止并说明原因。
- 如果 GitHub 已在合并时自动删除远程分支，则远程清理视为已完成。
- PR 描述使用 `Closes #N` 时，Issue 会在 PR 合并后自动关闭。

## 9. ChatGPT 直接修改远程仓库

连接 GitHub 后，ChatGPT 可以直接创建远程分支、commit 和 PR，不需要 Codex Cloud。

- 正式任务状态、roadmap、`AGENTS.md` 或 skills 变更：建议仍先创建 Issue，再走分支和 Ready PR。
- 普通研究草稿、学习资料、文案或 typo，且不改变正式状态：可以不建 Issue，直接创建远程分支和 PR。
- ChatGPT 的远程修改不会自动出现在本地；本地继续工作前需要同步远程。

## 10. 当前仓库约定

- 主分支：`master`。
- Issue 分支：`codex/issue-<number>-<short-slug>`。
- 一个 Issue 对应一个任务单元和一个 PR。
- PR 默认以 Ready 创建，目标分支为 `master`；Draft 仅用于实现未完成、验证失败、任务受阻或等待用户确认。
- 当前仓库未配置 GitHub Actions，也没有部署流程；不把 CI 当成当前必经步骤。
- 自动 Codex Review 与本地验证是当前主要质量检查。
