---
name: github-pr-review-fix
description: 处理本项目 GitHub Pull Request 上的外部 Review 评论（如第三方 Review bot 或人工评论）：先讲解问题，再在本地修复真问题、验证、commit 并 push 回原 PR。Only when the user explicitly says 处理 PR #N 的 Review、修复 PR #N 的审查问题、读取远程 review 问题. Not a default step of github-issue-workflow. Do not use for creating a new Issue, opening the initial PR, or merging.
---

# GitHub PR Review 修复工作流

## 完成边界

本 skill 只在用户明确要求时使用；Claude 单角色流程不依赖任何远程 Review。读取并解释评论后，直接修复确认为真问题的项并推送到原 PR；不创建新 PR、不合并。合并与任务验收由 `github-issue-workflow` 的验收步骤负责。用户可以缩小范围，例如「只解释不改」「只修第 2 条」。

## 1. 获取远程状态

1. 使用已认证的 `gh` CLI 读取 PR 元数据、diff、评论和未解决 Review threads。
2. 确认本地仓库、PR head 分支和远程分支一致。
3. 若云端已经推送新 commit，继续本地工作前先同步远程分支。

## 2. 先讲解再修复

1. 按严重程度列出仍可执行的 findings。
2. 对每项说明：对应文件、触发场景、影响、建议修复和需要重跑的验证。
3. 区分本次代码问题、既有基线问题和非阻塞建议。
4. 判定标准与 commit 前 `/code-review` 一致：确认为真问题的修；无法本地确定性复现、超出 Issue 声明范围、与最新 Issue 决策或项目规范冲突、判断为误报的不修，并在 PR 评论或描述里写明理由。不为技术判断等待用户确认；只有缺少密钥、权限、登录等授权类前提时才中断询问。
5. finding 与已确认规格冲突时，不为“通过 Review”反向改规格，按事实来源解决并说明。

## 3. 本地修复

1. 检查工作区，保留无关改动；无法隔离时停止。
2. 只修复判定为真问题的项，不扩大重构范围；修复会改变 API、数据、权限、交互或验收标准时，先回会话确认并更新 Issue。
3. 运行受影响的最小必要验证，并补充 Review 指出的缺失测试。
4. 只暂存本轮修复文件，使用中文 `fix: 简短说明` 创建 commit。
5. push 到原 PR 分支，更新 PR 说明或评论中的验证结果，resolve 已处理的 threads。
6. 修改了功能代码或重要边界时，push 后再次触发 `/code-review` 复审；仅回复、resolve thread 或 docs 收口时不重复触发。复审最多 2 轮。

## 4. 收口

重新读取 PR 状态，汇报：

- 已修复和未修复的问题及理由；
- 新 commit 与 push 状态；
- 验证结果和剩余风险；
- PR 当前的 Draft / Ready 状态。

Review 修复完成只代表问题已处理，不代表任务验收通过；验收和合并回到 `github-issue-workflow` 第 7、8 步。

## 停止条件

- PR、仓库或 head 分支无法确认。
- 本地工作区无法安全隔离。
- 修复方向存在会改变业务行为的歧义。
- 远程分支冲突、认证失败或需要改写历史。
