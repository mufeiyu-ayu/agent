# 源码快照与证据约定

## 研究对象

| 项目 | 本次固定值 |
| --- | --- |
| Pi 工作树 | `/Users/ayu/Learn/pi` |
| Pi commit | `8a7b0c03dfb702663acafb6dc29f8acaa4ffe391` |
| commit 日期与标题 | 2026-09-15 · `fix(ai): price Bedrock one-hour cache writes` |
| 本机 origin | `https://github.com/mufeiyu-ayu/pi.git`（本机 fork；不推定与上游实时一致） |
| 项目上游标识 | 源码 README / CONTRIBUTING 使用 `earendil-works/pi` |
| agent 基线 commit | `4e53bf681b9958ceac6991280cedbdad35612e80` |
| 开始时工作树 | 两个仓库均干净；本次只向 agent 写研究资料与入口链接 |
| 源码许可 | Pi 根目录 `LICENSE`：MIT；摘录保留路径与固定 revision |

这是**本机固定版本研究**。没有拉取更新，也没有把当前 npm 版本、上游主分支或本机安装的 `pi` 当作这个 checkout。

## 证据分层

1. **源码事实**：函数、类型、调用方与测试断言共同解释行为。短摘录是原文，省略处明确标示；标注写在摘录之外。
2. **架构归纳**：从多条真实链路总结所有权、依赖方向和失败语义。
3. **云端建议**：针对当前 agent 的设计候选，未实现，也不自动变成正式任务。
4. **验证状态**：阅读测试不等于运行测试；静态源码研究不等于真实 provider、进程恢复或多租户负载实测。实际执行的检查单独记入 `verification.md`。

重要区分：普通 CLI 的 `Agent` / `AgentSession` / `SessionManager` 与新的 `AgentHarness` / durable `Session` 是两条并存路径。`experimental/` 的本地进程架构不是所有 Pi CLI 请求的默认路径。`docs/` 中的 proposal、规划和示例不证明已实现。

## 如何回到原始证据

文中 Pi 源码位置写作相对 Pi 仓库根的 `packages/…:行号`（2026-09-23 去掉研究机前缀 `/Users/ayu/Learn/pi/`，本仓库文件改相对链接），行号只对应上面的 commit。本机查看时拼上自己的 Pi checkout；文件内的**符号名**比行号更稳定。

```sh
git -C /Users/ayu/Learn/pi rev-parse HEAD
git -C /Users/ayu/Learn/pi status --short
git -C /Users/ayu/Learn/pi show 8a7b0c03dfb702663acafb6dc29f8acaa4ffe391:packages/agent/src/agent-loop.ts
```

以后查阅先核对 HEAD；不一致时对照 `git diff <研究commit> -- <相关路径>`，更新受影响结论即可，不必重新扫描全仓。不要为了匹配文档直接切用户工作树。

## 全仓覆盖的含义

目标是覆盖仓库全部功能域、入口、持久化与协议边界、平台适配、扩展样例和工程工具，并把重要机制整理为可查阅的参照资料。文件清单用于发现遗漏；模块覆盖记录用于证明具体研究内容。清单中的文件存在、测试数量或源码行数，均不单独证明已读懂。

生成模型目录、二进制/图片、重复 fixtures、历史 changelog 不做逐行语义讲解：研究其生成者、消费者和边界，并在清单中区分类别。核心机制必须阅读实现与关键分支，不能仅凭 README 或类型名归纳。
