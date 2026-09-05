---
name: github-issue-workflow
description: 执行本项目 GitHub Issue 的实现、Review、验收、合并与收口工作流。Use when the user says 完成 Issue #N、读取 Issue #N 并实现、继续 Issue #N、合并 PR #N 并清理分支, or asks to submit the current Issue as a PR. Do not use for ordinary learning conversations, inspection-only work, local experiments, docs-only changes, or small changes unless the user explicitly promotes them into an Issue workflow.
---

# GitHub Issue 任务工作流

## 执行边界

「完成 Issue #N」默认一路执行到底：实现、验证、commit 前 `/code-review` 自审、PR、处理 Claude Code Review、基于 PR 最新 head 逐条验收、验收 PASS 后合并、清理分支、收口 docs 并汇报。实现和验收都由本会话完成，不存在另一个模型验收。

用户可以随时缩小范围，例如「先不要 commit」「只实现到本地验证」「停在 PR 让我看 diff」「用 Draft」。以本次明确指令为准。流程曾被缩小并停在某一步时，用户说「继续 Issue #N」就从停下的那一步接着执行。

## 1. 读取并确认 Issue

1. 优先使用已认证的 `gh` CLI 读取 Issue；连接能力不足时再尝试其他方式。
2. 读取 `CLAUDE.md`、`docs/tasks/README.md`、Issue 指向的 task 文档和相邻实现。
3. 从 Issue 的 `任务类型` 判断执行路径；缺失时根据内容推断并在开始前说明：
   - `feature / fix / refactor`：修改代码并记录实现证据。
   - `docs-task`：更新 Issue 明确要求的文档，不运行无关代码验证。
   - `phase-closeout`：同步归档、任务看板、roadmap 和必要的 work-log。
   - `research`：写入 `docs/research/**`；除非 Issue 明确要求，不改变执行任务状态。
4. Issue 与 task 文档存在会改变实现方向的冲突时，停止并请用户决定。
5. 一个 Issue 只对应一个任务单元，不顺手实现后续 Task。
6. Issue 规格与本会话已聊定的结论不一致时，以 Issue 最新正文为准；差异会改变实现方向的，先回到会话确认再动代码。

## 2. 准备任务分支

1. 检查当前分支、工作区、远程和默认主分支。
2. 保留所有无关改动；无法安全隔离时停止。
3. 联网 Git 命令遵守仓库代理规则。
4. 更新 `master` 时只接受 fast-forward，再从最新 `origin/master` 创建 `claude/issue-<number>-<short-slug>`。
5. 不直接在 `master` 上实现、提交或推送正式 Issue。

## 3. 实现与记录证据

1. 只实现 Issue 的目标、范围和验收标准。
2. 先复用真实代码中的相邻模式；保持小步可运行，不为可能的未来需求增加抽象。
3. 实现完成且必要验证通过后，更新任务文档中的 checklist、验证结果和 GitHub 交付记录，并设置：
   - `实施状态：已实现`
   - `验收状态：待验收`
4. 实现未完成、验证失败或任务受阻时，保留任务文档原状态并记录阻塞原因；不得写成“已实现、待验收”。
5. 实现阶段不把任务或阶段标记为 Completed，不推进下一任务，不归档阶段，不把 `docs/roadmap.md` 写成已完成；这些在第 7、8 步验收 PASS 后才做。
6. Issue 本身是实施快照；正式状态仍以 `docs/tasks/**` 为准。
7. 不向 `docs/development-task-plan.md` 写新任务。

## 4. 验证

1. 以 Issue、`CLAUDE.md`、当前 task 文档和 `package.json` 的真实脚本选择最小必要验证。
2. TypeScript、前端、后端和 Prisma 改动分别运行对应 typecheck、lint、build、测试或 Prisma 验证。
3. docs-only 任务至少运行链接或结构检查以及 `git diff --check`。
4. 区分本次回归与既有基线失败；不能把未运行或失败的检查写成已通过。

## 5. Commit、Push 与 PR

1. 再次检查 diff，只暂存当前 Issue 相关文件，不夹带用户的无关改动或敏感信息。
2. 暂存后、commit 前，必须用 Claude Code 内置 `/code-review` 审当前暂存的改动：
   - 审查范围是暂存区 diff。改动此时尚未 commit，findings 直接并入本次提交，不产生额外的修复 commit，也不需要 amend 或改写历史。
   - `docs-task` 及其他 docs-only 改动跳过本步。
   - 确认为真问题的 finding 自行修复，不为技术判断等待用户确认；修复后重新运行受影响的验证并重新暂存。
   - 以下情况不修，在最终回复和 PR 描述里写明理由：无法本地确定性复现；修复会超出 Issue 声明范围（触及“不在本任务范围”的模块、公共 contract、schema 或依赖）；与最新 Issue 决策或项目规范冲突，此时按事实来源解决，不得为了“通过 Review”反向违反已确认规格；判断为误报。
   - 只有缺少授权类前提时才中断并询问用户：密钥、token、权限、`gh` / git 登录、只有用户本人能提供的环境信息。不因技术意见取舍打断用户。
   - 修复后最多复审 2 轮；仍无进展就停止 review，记录剩余问题并继续交付，交由 PR 创建后的 Claude Code Review 和第 7 步验收处理。
3. 确认没有阻塞性 findings 后再 commit；标题使用中文 `type: 简短说明`，正文按需记录背景、改动、验证和风险。
4. 推送前用 `gh auth status --hostname github.com` 和 `git push --dry-run origin HEAD` 预检凭据，不输出 token；凭据失效立即停止并告知，不得绕过。推送当前任务分支，不推送或改写 `master`。
5. 创建目标为 `master` 的 PR，描述至少包含：
   - `Closes #<number>`；
   - 改动摘要和明确未做事项；
   - 验证命令与结果；
   - commit 前 `/code-review` 的结论与处理情况；
   - 已知风险或既有失败；
   - 建议阅读顺序和真实调用链。
6. 默认创建 Ready PR。只有实现未完成、验证失败、任务受阻或用户要求时才用 Draft；Draft 恢复后先完成实现和验证、更新为“已实现、待验收”，再转 Ready。
7. PR 创建后的远程 Claude Code Review 是第二道，不替代第 2 步的 commit 前自审；自动审核未触发或代码修复后需要复审时，再次使用 `/code-review`。
8. GitHub 连接或权限不可用时，保留本地成果并明确停止位置，不伪造远程状态。

## 6. 处理 Review

等待并读取远程 Claude Code Review 的 findings，按 `github-pr-review-fix` 的规则处理：解释、修复真问题、push 回原 PR、必要时复审。处理完毕才进入验收。

## 7. 验收

由本会话基于 PR 最新 head 执行，不需要用户先确认：

1. 读取 Issue 最新规格与决策记录、PR 最新 head 的 diff、Review findings 及处理结果、验证命令与真实输出。
2. 对每条验收标准逐条给出 PASS / FAIL / 未验证，并注明证据位置；边界、失败路径和长链路集成必须有对应证据。“测试命令成功”或“代码看起来合理”不单独构成 PASS。
3. 全部 PASS：把任务文档更新为 `实施状态：已实现`、`验收状态：已通过`，完成最终 checklist，更新 `docs/tasks/README.md`、`docs/roadmap.md`，记录一条 `docs/work-log.md` 事实；阶段完成时归档到 `docs/tasks/completed/`。收口改动在原 PR 分支 commit 并 push。
4. 任一 FAIL 或未验证：停在 PR，在会话和 PR 评论里说明原因与所需改动，不合并；修复后回到第 4 步重新验证并重新验收。

## 8. 合并与分支清理

验收 PASS 后直接执行，不再等待单独授权；用户事先要求停在 PR 时跳过本节并汇报：

1. 再次确认任务文档为 `验收状态：已通过`，远程分支 head 与验收时一致；不一致则重新验收。
2. 合并到 `master`；PR 若为 Draft，先转 Ready 再合并。
3. fast-forward 同步本地 `master`，确认合并内容已落入主分支。
4. 删除远程 Issue 分支；GitHub 已自动删除则视为完成。
5. 使用安全删除清理本地 Issue 分支；禁止强制删除未合并分支，安全删除失败则停止并说明。
6. 在会话汇报：合并 commit、Issue 状态、验收结论摘要、剩余风险与后续建议。

## 9. research / 学习 docs 边界

`research` 或学习 docs 沉淀任务可以写入 `docs/research/**`，也可以作为后续正式 Issue 的背景材料。默认规则：

- 设计对比、学习笔记、阶段总结和复盘写入 `docs/research/**`。
- 学习 docs 沉淀不等于正式任务状态变化。
- 不把计划写成已完成事实。
- 不自动修改 `docs/tasks/**`、`docs/roadmap.md` 或 `docs/work-log.md` 的正式状态。
- 当学习计划转为功能、修复、重构、数据库、API、Agent Runtime、Tool Calling 或权限任务时，再进入正式 Issue 工作流。

## 停止条件

- Issue 与 task 文档冲突，或 Issue 与会话结论的差异会改变实现方向。
- 工作区包含无法隔离的无关改动。
- 主分支不能 fast-forward、出现冲突或认证失败。
- 必要验证失败且尚未解释。
- 验收存在 FAIL 或未验证项。
- 缺少密钥、权限、登录等只有用户能提供的前提。
- 用户明确要求停在某一步。
