---
name: git-commit
description: 执行项目提交前的固定流程。Use when the user asks to commit、提交代码、git commit、帮我提交、提交当前改动, or when a commit should update docs/work-log.md and, if applicable, docs/learning-log.md before creating the git commit.
---

# Git Commit 工作流

## 概述

本 skill 规范本项目的提交流程。目标是让每次 commit 不只是保存代码，也同步保存项目上下文，方便后续 Codex 快速恢复记忆。

注意：skill 不能像函数一样真正“调用另一个 skill”。当本 skill 被触发时，Codex 必须按下面流程主动执行 `docs/work-log.md` 和必要的 `docs/learning-log.md` 更新，相当于把两个记录流程串起来。

## 默认流程

1. 读取当前状态：
   - `git status --short`
   - `git diff --stat`
   - 必要时读取关键 diff 或关键文件
2. 判断是否需要更新记录：
   - 总是检查是否需要更新 `docs/work-log.md`，但写入前必须先和用户确认拟记录内容，记录本次 commit 的项目推进、核心完成、验证结果和下一步。
   - 总是检查 `docs/development-task-plan.md`。如果本次提交推进了业务任务，必须更新对应任务的 `状态`、`验收标准` 或 `下一步`；如果新增了不属于现有行的业务能力，先新增任务行。
   - 默认不要更新 `docs/learning-log.md`。只有本次提交确实包含 Agent 概念学习或 Agent 链路错误排查，例如 LLM API、`messages`、prompt、JSON Output、streaming、Tool Calling、上下文管理、记忆、评估、安全边界、Agent 可观测性，才更新学习日志。
   - 普通工程搭建、依赖安装、UI 调整、后端基础设施、commit 上下文和项目管理信息只写 `docs/work-log.md`；不要写进 `docs/development-task-plan.md`，除非它们直接改变业务任务的完成状态。
3. 更新记录前和用户确认：
   - 说明准备写入 `docs/work-log.md` 的记录摘要、关键文件、验证结果和下一步。
   - 用户确认后再修改 `docs/work-log.md`。
4. 提交前验证：
   - 优先运行与本次改动相关的最小验证。
   - 常规工程改动默认运行 `pnpm lint`。
   - 涉及 TypeScript / Vue / Nest 代码时，运行 `pnpm typecheck`。
   - 涉及前端构建或 Vite 配置时，运行 `pnpm --filter @agent/web build`。
   - 如果某项验证无法运行，要在最终回复和 `docs/work-log.md` 里说明原因。
5. 暂存文件：
   - 使用 `git add` 暂存本次相关改动。
   - 不要还原用户已有改动。
   - 如果发现明显无关或敏感文件，先停下说明。
   - 如果本次同时包含业务代码和 `docs/learning-log.md`，不要默认放进同一个提交；优先把业务代码、`docs/work-log.md` 与依赖锁文件作为一个提交，把 `docs/learning-log.md` 作为单独 docs 提交。
6. 创建 commit：
   - 提交信息使用中文。
   - 格式建议：`type: 简短说明`
   - 常用 type：`feat`、`fix`、`docs`、`refactor`、`chore`、`test`
7. 提交后更新记录：
   - 获取短 hash：`git rev-parse --short HEAD`
   - 如果 `docs/work-log.md` 中本次记录的 `提交` 仍是 `待提交`，将其改为短 hash 和提交信息。
   - 如果只修改了 `docs/work-log.md` 中的提交 hash，创建第二个 `docs` commit；除非用户明确要求“只要一个 commit”，则提交前先把 commit 信息写入为“待提交”，最终回复中说明 hash。
   - 如果修改了 `docs/learning-log.md`，该文件应保持独立 docs commit，避免和普通业务代码改动混在一起。
8. 最终回复：
   - 说明 commit hash 和提交信息。
   - 说明执行过的验证。
   - 说明是否更新了 `docs/work-log.md` 和 `docs/learning-log.md`。

## 记录职责

- `docs/development-task-plan.md`：记录项目完成路径和业务任务状态，是后续判断“下一步做什么”的主看板。
- `docs/work-log.md`：记录项目推进、commit 上下文、关键决策、验证结果、下一步。
- `docs/learning-log.md`：记录 Agent 概念学习、阶段复盘、学习问题和理解变化。

## 安全规则

- 不提交 `.env`、API Key、token、密码、私有服务密钥。
- 不执行 `git reset --hard`、`git clean -fd`、`git checkout --` 等破坏性命令，除非用户明确要求。
- 不自动 `git push`，除非用户明确说推送。
- 如果 git 工作区包含明显无关的大量改动，先说明范围，再只提交本次相关文件。
