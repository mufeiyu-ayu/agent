---
name: github-pr-review-fix
description: 获取并处理本项目 GitHub Pull Request 的 Codex Review findings，先讲解问题，再按用户确认在本地修复、验证、commit 并 push 回原 PR。Use when the user says 处理 PR #N 的 Review、修复 PR #N 的审查问题、读取远程 review 问题, or asks to continue a Draft PR after automated review. Do not use for creating a new Issue, opening the initial PR, or changing final task acceptance status.
---

# GitHub PR Review 修复工作流

## 完成边界

默认只读取并解释问题，不立即修改。用户确认具体 finding 后，才在本地修复并推送到原 PR；不创建新 PR、不转为 Ready、不合并。

## 1. 获取远程状态

1. 使用 GitHub 工具读取 PR 元数据、diff、评论和未解决 Review threads。
2. 确认本地仓库、PR head 分支和远程分支一致。
3. 若云端已经推送新 commit，继续本地工作前先同步远程分支。

## 2. 先讲解再修复

1. 按严重程度列出仍可执行的 findings。
2. 对每项说明：对应文件、触发场景、影响、建议修复和需要重跑的验证。
3. 区分本次代码问题、既有基线问题和非阻塞建议。
4. 等待用户确认要修复的具体项目；“处理 Review”本身不等于授权修复全部问题。

## 3. 本地修复

1. 检查工作区，保留无关改动；无法隔离时停止。
2. 只修复用户确认的问题，不扩大重构范围。
3. 运行受影响的最小必要验证，并补充 Review 指出的缺失测试。
4. 只暂存本轮修复文件，使用中文 `fix: 简短说明` 创建 commit。
5. push 到原 PR 分支，更新 PR 说明或评论中的验证结果。

## 4. 云端修复边界

只有用户明确选择云端修复时，才在 PR 中按具体问题请求，例如 `@codex fix the P1 issue`。

- 禁止本地与云端同时修改同一 PR 分支。
- 云端推送后，本地继续工作前必须同步远程。
- 不使用模糊的“修复全部问题”跳过用户学习。

## 5. 收口

重新读取 PR 状态，汇报：

- 已修复和未修复的问题；
- 新 commit 与 push 状态；
- 验证结果和剩余风险；
- PR 是否仍为 Draft。

Review 修复完成只代表问题已处理，不代表任务验收通过。保持 `验收状态：待验收`；未经用户明确确认，不转为 Ready、不合并、不写入 Completed。

## 停止条件

- PR、仓库或 head 分支无法确认。
- 本地工作区无法安全隔离。
- 修复方向存在会改变业务行为的歧义。
- 远程分支冲突、认证失败或需要改写历史。
