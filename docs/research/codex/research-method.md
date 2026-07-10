# 研究方法与证据边界

## 1. 研究目标

本次研究不是对 Codex 仓库做百科式摘要，而是为当前 AI SEO Agent 提取可迁移的架构知识。所有结论都要经过三层判断：

1. 这是不是本地源码能够证明的事实？
2. 这个事实背后的设计约束是什么？
3. 这个约束在云端 NestJS Agent 中应该如何表达？

## 2. 证据等级

| 等级 | 含义 | 可以支持什么结论 |
| --- | --- | --- |
| A：当前源码 | 本地 fork 中的类型、函数、测试和调用链 | “Codex 当前如何实现” |
| B：官方文档 | OpenAI 官方 Codex 文档 | 公开协议语义和产品边界 |
| C：当前项目源码 | 当前 Agent 的代码、schema 和任务文档 | “项目现在真实具备什么” |
| D：迁移设计 | 基于 A/B/C 推导的架构建议 | “项目接下来应该怎么学”，不能写成已实现 |

每份报告应尽量同时给出 A/C 证据，再单独标记 D 类建议。

## 3. 本次快照

### Codex fork

- 路径：`/Users/ayu/Desktop/codex`
- 分支：`main`
- commit：`626147f72`
- remote：用户 fork `https://github.com/mufeiyu-ayu/codex.git`
- 研究时 tracked worktree 无修改。
- 未跟踪的 `AGENTS 2.md` 和 `excalidraw/` 不属于本次研究内容，也未修改。

### 当前 Agent 项目

- 路径：`/Users/ayu/Desktop/agent`
- 分支：`master`
- 研究起点 commit：`0a0b835`
- 当前任务看板：阶段 5 最小 Tool Calling 仍为 Planned。

## 4. 官方资料

- [Codex App Server](https://developers.openai.com/codex/app-server)：Thread、Turn、Item、JSON-RPC 生命周期和事件流。
- [Codex SDK](https://developers.openai.com/codex/sdk)：SDK 作为 runtime facade 的公开定位。
- [Codex GitHub 仓库](https://github.com/openai/codex)：公开源码入口。

本地源码优先用于实现细节，官方文档优先用于公开术语。两者不一致时，要先检查本地 fork 是否落后，不能静默混用。

## 5. 阅读策略

### 沿主链读，不按目录名猜

```text
turn/start
  -> Op::UserInput
  -> submission_loop
  -> RegularTask
  -> run_turn
  -> ModelClientSession::stream
  -> ResponseEvent
  -> ToolRouter / assistant message
  -> event + persistence
```

只有沿真实调用链，才能区分“协议门面”“运行编排”“模型适配”“工具执行”和“展示事件”。

### 测试也是架构文档

Codex 的大量约束只在测试中表达，例如：

- 协议序列化是否稳定。
- turn 中断后最终状态是什么。
- tool call 与 output 是否成对。
- context rollback / compaction 后历史是否仍合法。
- thread resume / fork 是否恢复正确事实。

阅读一个模块时，至少同时阅读一个正常用例和一个失败用例。

## 6. 迁移时的四个过滤器

每个 Codex 能力都先经过以下过滤：

1. **业务必要性**：SEO Agent 是否真的需要？
2. **运行位置**：客户端本地能力还是服务端云能力？
3. **风险等级**：只读业务工具、写操作、外部副作用还是系统命令？
4. **学习顺序**：是否依赖更基础的单 Agent loop、持久化或测试能力？

只有通过过滤后，才进入学习路线。

## 7. 文档维护规则

- 路径和行号是导航，不是永久 API；Codex 更新后必须重新搜索符号。
- 当前项目状态以 `docs/tasks/README.md` 和真实代码为准。
- 研究文档中的 Planned / Later 不能被误读为已完成。
- 每个阶段收口时，回查本研究中引用的项目文件是否已移动。
- 如果实现方向改变，先更新映射和非目标，再改阶段任务。

## 8. 本次研究限制

- 没有把 Codex 每个 crate、工具或 UI 逐一讲解。
- 没有验证所有平台 sandbox 实现。
- 没有把 Codex 的云端后端私有实现当作可见源码事实。
- 没有假设当前项目已经具备登录、多租户、队列、Redis 或部署能力。
- 不用“成熟项目这样做”代替当前项目的最小可验证需求。
