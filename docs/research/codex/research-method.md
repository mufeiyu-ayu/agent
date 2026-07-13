# Codex 架构研究方法与证据边界

## 1. 可复现快照

本轮研究只以以下本地快照为源码事实基线；文档中的“当前 Codex”均指该 commit，而不是不带版本的“最新版”。

| 项目 | 值 |
| --- | --- |
| 只读仓库 | `/Users/lihaoran/Desktop/codex`（Issue 中 `/Users/ayu/Desktop/codex` 在本机的等价路径） |
| 分支 | `main` |
| 完整 commit | `ab6a7eb87cc8a816c88b86c44cf291e251ed2136` |
| commit 时间 | `2026-07-13T10:12:41+08:00` |
| commit 标题 | `Merge remote-tracking branch 'upstream/main'` |
| remote | `origin=https://github.com/mufeiyu-ayu/codex.git`；`upstream=https://github.com/openai/codex.git` |
| worktree | tracked 与 untracked 文件均无修改；研究期间只读 |
| 研究开始时间 | `2026-07-13 11:01 CST` |

启动时已执行 `git fetch origin main` 和 `git merge --ff-only origin/main`，结果为 `Already up to date`。因此研究的是 fork 当前最新 `main`，不是旧快照 `626147f72`。若未来复查，应先定位上述完整 SHA，再用稳定符号重定位路径。

当前 Agent 项目的研究起点是 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`；正式研究分支为 `codex/issue-6-rebuild-codex-research`。本 Issue 只修改 `docs/research/**`。

## 2. 证据等级

| 等级 | 证据 | 可支持的表述 |
| --- | --- | --- |
| A | 当前 Codex 快照中的源码、类型、函数、测试与调用链 | “Codex 当前如何实现” |
| B | 同一快照中的协议定义、README 与公开文档 | 公开语义与产品边界；不能替代实现证据 |
| C | 当前 Agent 项目的源码、schema、contracts 与测试 | “当前项目已经具备什么” |
| D | 基于 A/B/C 的架构解释与迁移判断 | “为什么这样设计”“当前项目应如何学习”；不能写成源码事实 |

重要结论至少记录“稳定符号 + 文件路径 + 正常/失败测试”；行号只作临时导航。文档用以下标签避免把推导伪装成事实：

- **源码事实**：能由 A/B 级证据直接复现。
- **架构解释**：从多个事实提炼出的控制权、状态所有权或不变量。
- **迁移建议**：结合当前 NestJS/Vue 项目约束给出的选择。

## 3. 按问题沿调用链取证

每个研究批次遵循同一顺序：

```text
架构问题
  -> 产品或协议入口
  -> 内部请求/操作
  -> 状态所有者
  -> 副作用执行者
  -> 事件与持久化出口
  -> 正常和失败测试
  -> 设计不变量
  -> 正式文档与覆盖状态
```

例如普通 Turn 主链不是“阅读 `core/src`”，而是：

```text
turn/start
  -> TurnRequestProcessor::turn_start_inner
  -> Op::UserInput
  -> session::handlers::submission_loop
  -> RegularTask::run
  -> session::turn::run_turn
  -> ModelClientSession::stream
  -> ResponseEvent
  -> ToolRouter / ContextManager
  -> EventMsg + rollout
```

优先使用 `rg`、`git grep`、`git ls-files`、`cargo metadata --no-deps`。跳过生成文件、vendor、target、大型 snapshot 内容和与架构结论无关的 UI 样式；只有平台实现能说明权限或恢复不变量时才深入。

## 4. 测试作为状态机证据

每个领域至少找一条正常路径和一条失败、取消、边界或恢复路径。测试的作用不是证明“仓库全绿”，而是定位谁拥有最终决定权：

- 协议测试证明序列化和 notification 投影边界。
- `core/tests/suite` 的 fake response stream 证明 Turn、Tool、Interrupt、Compaction 的运行语义。
- 模块内 tests 证明 router、registry、history normalization、approval 与 sandbox 的局部不变量。
- rollout、thread-store、state tests 证明哪些事实可恢复以及损坏/中断如何收口。

本任务不运行 Codex 全仓测试；引用的是该 commit 已提交的测试源码。路径存在性由收尾校验单独验证。

## 5. 周额度语义与停止协议

额度脚本是 `$HOME/.local/bin/codex-weekly-usage.py`，只读检查确认：

1. 它从 `$CODEX_HOME/sessions` 与 `archived_sessions` 的 JSONL 中寻找 `limit_id == "codex"`。
2. 只接受 `window_minutes == 10080`（7 天）的 `primary`、`secondary` 或 `individual_limit` 窗口。
3. 原始字段是 `used_percent`；脚本输出同时给出已用和剩余。
4. 换算为 `weeklyRemaining = max(0, 100 - weeklyUsed)`。

实际命令：

```bash
test -r "$HOME/.local/bin/codex-weekly-usage.py"
python3 "$HOME/.local/bin/codex-weekly-usage.py"
```

启动预检读数为“已用 3%，剩余 97%”，采样时间 `2026-07-13 11:01:17 CST`。本任务只用周额度剩余百分比判断停止；`weeklyRemaining < 50%` 时不再启动新领域，只完成当前原子章节、覆盖状态、索引、校验、收尾和 PR。脚本连续两次失败或语义无法确认时也按停止策略处理，不猜测额度。

每个主要批次开始和结束、进入 P1、大范围重写前、最终收尾前都记录读数到 [research-progress.md](./research-progress.md)。

## 6. 路径与兼容性规则

- 保留 Issue 启动时所有 `docs/research/**` 已跟踪路径，不删除、重命名或移动。
- 新文件同时进入 [研究区总索引](../README.md) 和 [Codex 子索引](./README.md)。
- 不新增与 `codex/`、`learning-roadmap/` 并列的第三个顶级目录。
- 绝对路径只记录研究环境；可点击的文档导航使用相对链接。
- Codex 路径必须在快照中真实存在；符号改名时更新结论，不用旧行号掩盖变化。
- `docs/tasks/**`、`docs/roadmap.md` 与业务代码不属于本 Issue。

## 7. 研究限制

- 本知识库解释公开仓库可见的客户端 Runtime，不推测不可见的云端内部实现。
- 不逐 crate、逐工具或逐 UI 文件做百科摘要。
- 不验证每个平台 sandbox 的系统调用细节。
- 当前项目映射只描述已有证据和迁移触发条件，不要求照搬 Codex。
- `Completed` 表示该研究域在本快照上形成“入口—调用链—状态—测试—不变量”闭环，不表示当前 Agent 项目已经实现。
