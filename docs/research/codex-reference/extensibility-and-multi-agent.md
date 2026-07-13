# Extensibility 与 Multi-agent：保留资料，不抢当前主线

## 1. 核心结论

Codex 有大量扩展能力：MCP、Skill、Plugin、Hook、App、Environment、Goal、Memory、Multi-agent、Code Mode、Exec Server 等。它们很有研究价值，但当前 AI SEO Agent 不应过早照搬。

当前判断：

```text
内置工具 + 单 Agent Tool Loop 未稳定前
  -> 不做 MCP / Plugin / Multi-agent
```

## 2. 概念边界

| 概念 | Codex 中的大致作用 | 当前项目迁移判断 |
| --- | --- | --- |
| MCP | 外部工具和资源协议 | 内置工具稳定后再评估 |
| Skill | 按需加载的指令/资源 | 可作为 prompt/template 管理思想参考 |
| Plugin | 分发和组合单元 | 暂不做 |
| Hook | 生命周期拦截和改写 | Tool 可靠性后再考虑最小 hook |
| App / Connector | 用户授权的外部能力来源 | 多租户和 OAuth 前不做 |
| Environment | 本地/远程执行能力与文件系统边界 | 云端项目先用 server runtime，不做通用环境 |
| Goal | 跨 Turn 的长期目标和预算状态 | 有长任务产品形态后再做 |
| Memory | 异步抽取、引用和遗忘 | RAG/知识库稳定后再做 |
| Multi-agent | 独立 child Thread、通信和容量治理 | 单 Agent 不能满足后再实验 |

## 3. 高价值思想，可以先学

### 3.1 Extension 不是随便给 runtime 打补丁

Codex 的扩展能力通过 typed contributor、registry、snapshot 和 policy 进入 runtime。它强调：

- 谁能贡献 context。
- 谁能暴露 tool。
- 谁能改写输入。
- 谁能拥有状态。
- 贡献失败是否影响主 Turn。

当前项目未来做插件时，也应先定义 extension contract，而不是让插件直接拿 Nest service 随便改状态。

### 3.2 Dynamic tools 要有可见性和执行 generation

工具动态发现的问题不是“把工具列表塞给模型”这么简单，而是：

```text
模型看到哪些 tool specs
  -> 对应哪个 registry generation
  -> 执行时是否仍使用同一代 schema / policy / credentials
```

当前项目短期用静态内置工具，能避免大量复杂度。

### 3.3 Goal 是 Thread 级业务状态，不是更长 prompt

Codex 的 Goal 设计包含 objective、status、budget、usage、idle continuation 等。它的价值是长任务控制，而不是把用户目标塞进 system prompt。

当前项目暂时不做 Goal，但要记住：未来如果做“持续优化一个站点 SEO”的长期任务，需要的是持久状态机，不是隐藏 prompt。

### 3.4 Multi-agent 是独立 child Thread，不是多个函数互相调用

Multi-agent 的复杂度来自：

- child Thread 身份。
- 父子通信。
- token / runtime capacity。
- 结果回传。
- cancellation / recovery。
- 权限继承。

当前 AI SEO Agent 可以先用单 Agent + 多工具覆盖大部分需求。只有当任务天然需要独立上下文、并行研究或不同角色隔离时，才考虑 Multi-agent。

## 4. 什么时候才转成任务

### MCP / Plugin

满足以下条件再评估：

- 已有 3 个以上稳定内置工具。
- 工具 schema、权限、timeout、observation 记录都稳定。
- 用户确实需要接入外部工具生态。
- 有租户和凭证管理。

### Goal / Memory

满足以下条件再评估：

- 产品出现跨多次会话持续推进的任务。
- 有 Run recovery 和 budget 记录。
- 有明确暂停、恢复、完成、失败语义。
- 用户能看到和控制长期状态。

### Multi-agent

满足以下条件再实验：

- 单 Agent + 工具已经无法表达任务边界。
- 子任务需要独立上下文和独立失败收口。
- 可以度量多 Agent 相比单 Agent 的收益。
- 有 capacity / cost / cancellation 策略。

## 5. 当前只保留的学习价值

| Codex 高级设计 | 现在学什么 |
| --- | --- |
| MCP refresh / exposure | 工具可见性和执行 registry 必须同代 |
| Plugin / Skill | 不同来源的 prompt/tool 不能互相授权 |
| Hook | pre/post 的副作用边界不同 |
| Goal | 长期目标是持久状态机，不是 prompt |
| Memory | 异步抽取要有来源、版本和遗忘边界 |
| Multi-agent | child Thread 不是普通 tool call |
| Exec Server | 远程执行需要 capability snapshot 和 recovery |

## 6. 明确非目标

近期不创建以下正式任务：

- MCP server 接入。
- Plugin marketplace。
- Skill 包管理。
- Goal runtime。
- Memory pipeline。
- Multi-agent。
- Code Mode。
- Remote Exec Server。

这些材料留在知识库中，供后续架构讨论查阅。
