---
name: github-issue-workflow
description: 执行本项目 GitHub Issue 的实现、验收收口与合并后分支清理工作流。Use when the user says 完成 Issue #N、读取 Issue #N 并实现、GPT 已确认 Issue #N 验收通过且用户确认收口、合并 PR #N 并清理分支, or asks to submit the current Issue as a PR. Do not use for ordinary learning conversations, inspection-only work, local experiments, GPT 轻量 docs PR, or small changes unless the user explicitly promotes them into an Issue workflow.
---

# GitHub Issue 任务工作流

## 三种执行模式

- **实现模式**：“完成 Issue #N”默认执行到 Ready PR、自动 Codex Review、验证结果和学习交接。只记录“已实现、待验收”，不把任务标记为 Completed。
- **验收收口模式**：只有用户明确说明 GPT 已验收且自己也确认通过，才更新正式任务状态。
- **合并清理模式**：只有用户明确授权合并，才合并 PR、同步 `master` 并清理分支。

用户可以随时缩小范围，例如“先不要 commit”“只实现到本地验证”。以本次明确指令为准。

## 1. 读取并确认 Issue

1. 优先使用已连接的 GitHub 工具读取 Issue；连接能力不足时再使用已认证的 `gh`。
2. 读取 `AGENTS.md`、`docs/tasks/README.md`、Issue 指向的 task 文档和相邻实现。
3. 从 Issue 的 `任务类型` 判断执行路径；缺失时根据内容推断并在开始前说明：
   - `feature / fix / refactor`：修改代码并记录实现证据。
   - `docs-task`：更新 Issue 明确要求的文档，不运行无关代码验证。
   - `phase-closeout`：仅在验收收口模式下同步归档、任务看板、roadmap 和必要的 work-log。
   - `research`：写入 `docs/research/**`；除非 Issue 明确要求，不改变执行任务状态。
4. Issue 与 task 文档存在会改变实现方向的冲突时，停止并请用户决定。
5. 一个 Issue 只对应一个任务单元，不顺手实现后续 Task。

## 2. 准备任务分支

1. 检查当前分支、工作区、远程和默认主分支。
2. 保留所有无关改动；无法安全隔离时停止。
3. 联网 Git 命令遵守仓库代理规则。
4. 更新 `master` 时只接受 fast-forward，再从最新 `origin/master` 创建 `codex/issue-<number>-<short-slug>`。
5. 不直接在 `master` 上实现、提交或推送正式 Issue。

## 3. 实现与记录证据

1. 只实现 Issue 的目标、范围和验收标准。
2. 先复用真实代码中的相邻模式；保持小步可运行，不为可能的未来需求增加抽象。
3. 只有实现完成且必要验证通过后，才更新 Issue 对应任务文档中的 checklist、验证结果和 GitHub 交付记录，并设置：
   - `实施状态：已实现`
   - `验收状态：待验收`
4. 实现未完成、验证失败、任务受阻或等待用户确认时，保留任务文档原状态并记录阻塞原因；不得写成“已实现、待验收”，也不得进入 GPT 验收。
5. 实现模式不得把任务或阶段标记为 Completed，不推进下一任务，不归档阶段，也不把 `docs/roadmap.md` 写成已完成。
6. Issue 本身是实施快照；正式状态仍以 `docs/tasks/**` 为准。
7. 不向 `docs/development-task-plan.md` 写新任务。

## 4. 验证

1. 以 Issue、`AGENTS.md`、当前 task 文档和 `package.json` 的真实脚本选择最小必要验证。
2. TypeScript、前端、后端和 Prisma 改动分别运行对应 typecheck、lint、build、测试或 Prisma 验证。
3. docs-only 任务至少运行链接或结构检查以及 `git diff --check`。
4. 区分本次回归与既有基线失败；不能把未运行或失败的检查写成已通过。

## 5. Commit、Push 与 Ready PR

1. 再次检查 diff，只暂存当前 Issue 相关文件，不夹带用户的无关改动或敏感信息。
2. commit 标题使用中文 `type: 简短说明`；正文按需记录背景、改动、验证和风险。
3. 推送当前任务分支，不推送或改写 `master`。
4. 本地验证通过后，创建目标为 `master` 的 Ready PR，描述至少包含：
   - `Closes #<number>`；
   - 改动摘要和明确未做事项；
   - 验证命令与结果；
   - 已知风险或既有失败；
   - 建议阅读顺序和真实调用链。
5. Ready 只表示 PR 可以接受 Review，不表示验收通过或允许合并。实现未完成、验证失败、任务受阻或等待用户确认时才使用 Draft。
6. Draft PR 恢复后，必须先完成实现和必要验证、把任务文档更新为“已实现、待验收”，再转为 Ready 接受 Review；不得从 Draft 直接进入 GPT 验收或合并。
7. Ready PR 创建后依靠自动 Codex Review；仅在自动审核未触发或代码修复后需要复审时使用 `@codex review`。
8. GitHub 连接或权限不可用时，保留本地成果并明确停止位置，不伪造远程状态。

## 6. 学习交接

Ready PR 创建后说明：

- 本次解决的问题；
- 建议阅读顺序和调用链；
- 关键文件职责与设计取舍；
- 测试保护的行为和剩余风险；
- 建议用户追问的 2-4 个问题。

自动 Codex Review 出现问题时，交由 `github-pr-review-fix` 后续处理。当前流程不要求 GitHub Actions，验证以本地结果为准。

## 7. 验收收口

只有用户明确表达“GPT 已确认 Issue #N 验收通过，我也确认通过，请收口任务状态”等同等授权时执行：

1. 读取 Issue、当前 PR、Review 结果和对应 task 文档，确认实现证据完整且没有未处理的阻塞问题。
2. 将任务文档更新为 `实施状态：已实现`、`验收状态：已通过`。
3. 只有此时才允许完成最终 checklist、更新 `docs/tasks/README.md` / `docs/roadmap.md`、归档已完成阶段以及记录必要的 `docs/work-log.md`。
4. 在原 PR 分支 commit 并 push 收口改动；除非用户同时明确授权，PR 仍保持 Ready，不合并。

如果用户已授权 GPT 完成远程收口说明或轻量 docs 更新，本 skill 不重复执行同一远程提交；Codex 只处理用户明确要求的本地同步或后续本地工作。

## 8. 合并与分支清理

只有用户明确授权合并 PR 时执行：

1. 再次确认 PR 的 `验收状态：已通过` 且远程分支没有变化；未通过则停止，不得合并。
2. Ready PR 直接合并到 `master`，正常流程不需要状态转换。PR 若仍为 Draft，则停止合并并返回实现流程：完成实现和验证、更新为“已实现、待验收”、转为 Ready 接受 Review，再等待 GPT 验收和用户合并授权。
3. fast-forward 同步本地 `master`，确认合并内容已落入主分支。
4. 删除远程 Issue 分支；如果 GitHub 已自动删除或 GPT 已删除，则视为已完成，不重复执行。
5. 使用安全删除清理本地 Issue 分支。
6. 禁止强制删除未合并分支；如果安全删除失败，停止并说明原因。
7. 尚未合并的分支继续保留；放弃任务的分支只有用户确认后才删除。

如果用户已授权 GPT 完成远程合并和远程分支删除，本 skill 只负责本地 `master` 同步、本地分支清理或用户明确要求的本地检查；不得重复合并或重复删除远程分支。

## 9. research / 学习 docs 边界

`research` 或学习 docs 沉淀任务可以写入 `docs/research/**`，也可以作为后续正式 Issue 的背景材料。默认规则：

- 用户确认后可以沉淀学习路线、技术方案、阶段总结和项目复盘。
- 学习 docs 沉淀不等于正式任务状态变化。
- 不把计划写成已完成事实。
- 不自动修改 `docs/tasks/**`、`docs/roadmap.md` 或 `docs/work-log.md` 的正式状态。
- 当学习计划转为功能、修复、重构、数据库、API、Agent Runtime、Tool Calling 或权限任务时，再进入正式 Issue 工作流。

## 停止条件

- Issue 与 task 文档冲突。
- 工作区包含无法隔离的无关改动。
- 主分支不能 fast-forward、出现冲突或认证失败。
- 必要验证失败且尚未解释。
- 用户未明确确认 GPT 验收结论，却要求写入 Completed 状态。
- 用户未授权合并或删除未合并分支。
- GPT 已完成远程合并 / 删除时，用户未要求 Codex 做本地同步或本地清理。
