# Task 3：Tool Observation 的 Context 策略

## 任务状态

- 看板状态：Planned
- 实施状态：未开始
- 验收状态：未验收
- 前置任务：Task 2 Completed
- Issue：未创建
- PR：未创建

## 目标

在阶段 5 已有 8,000 Unicode code point 硬上限基础上，补齐 Tool Observation 进入模型前的来源标记、字段投影、敏感信息策略、token 贡献、截断原因和 call / result 原子性，使工具数据始终作为不可信 Observation 被安全消费。

## 背景

当前 `normalizeToolObservation()` 已经解决单条 Observation 无限增长的问题，并向 AgentStep 记录字符数和 `truncated`。但 Context 层仍需要回答：

- 这段内容来自哪个工具和哪次 call？
- 哪些字段允许给模型，哪些只能给业务代码或 Admin 安全视图？
- 8,000 字符以内是否仍可能超出本轮 token budget？
- 内容被截断时，模型和日志如何知道原因？
- 恶意网页、文章或 API 文本中的“指令”为什么不能改变 system policy？

## 学习重点

- `ToolResult.data`、`ToolResult.modelContent`、durable Step summary 和 UI data 的差异。
- untrusted data / prompt injection 的工程边界。
- hard ceiling 与 per-request context budget 的区别。
- allowlist projection、redaction、source marker 与 provenance。
- 为什么 Tool Call / Observation 必须作为原子单元参与预算。

## 范围

- 保留现有 8,000 Unicode code point 上限，避免重复实现同一安全能力。
- 为 model-visible Observation 增加或统一安全元数据：
  - `callId`；
  - tool name / version（以当前可用事实为准）；
  - source marker；
  - original / projected / observation size；
  - estimated tokens；
  - `truncated`；
  - truncation reason；
  - success / failure status。
- 明确通用 policy：
  - 完整 `ToolResult.data` 默认不直接进入模型；
  - 每个工具负责生成受控 `modelContent` 或 projector 输出；
  - secret、stack、内部标识和未声明字段不得进入 model-visible content；
  - 外部内容中的指令按数据处理，不能覆盖 system / developer instructions 或服务端权限策略。
- 将 Observation 纳入 Task 2 的 per-source budget；必要时在硬上限以内再次按 Context budget 截断。
- 截断 envelope 必须明确内容不完整，避免模型误以为拿到完整结果。
- Tool Call 与对应 Observation 作为完整单元 include / truncate / exclude。
- 覆盖成功、零结果、工具业务失败、timeout、超长内容和恶意指令文本 fixture。

## 不做什么

- 不把完整 raw tool data、参数或 Observation 落入 AgentStep。
- 不新增写工具、外部网络工具或权限系统。
- 不实现 RAG；未来检索结果也必须复用本任务的不可信 Observation 边界。
- 不实现跨进程 Tool facts 或重放。
- 不改变 `ChatStreamEvent` 对前端的稳定协议。
- 不实现自动重试。

## Red：先定义失败用例

- [ ] 8,000 字符以内但 token 占用过高的 Observation 仍挤满 Context。
- [ ] Tool 内容包含“忽略系统指令”等文本时，没有测试证明其只作为 tool data 进入。
- [ ] 失败 ToolResult 的 raw data 或 stack 可能被拼给模型或日志。
- [ ] Observation 被截断后，模型看不出内容不完整。
- [ ] 预算只移除 result、保留 call，或只移除 call、保留 result。
- [ ] source decision 无法关联到具体 callId / tool。

## Green：最小实现

- [ ] 建立统一 Observation context projector / policy。
- [ ] 输出受控 model content 和安全 metadata，不暴露 raw data。
- [ ] 同时应用 hard character ceiling 与 Context token budget。
- [ ] 明确 source / provenance 和 truncation reason。
- [ ] 对恶意指令、敏感字段、失败结果和超长结果添加确定性测试。
- [ ] 保证 call / result pair 原子处理。

## Refactor：整理边界

- [ ] Tool implementation 负责业务字段选择，通用 Observation policy 负责安全 envelope、预算和 metadata。
- [ ] Runtime 不根据自然语言内容猜测工具是否安全。
- [ ] AgentStep 只记录 allowlist summary，和 model-visible content 使用不同 projector。

## 验证命令

```bash
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:tools
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

## 验收标准

- [ ] 现有 8,000 code point 上限保留且测试不回归。
- [ ] Observation 有稳定 source marker、callId 关联、token estimate 和 truncation reason。
- [ ] 完整 raw data、secret、stack 和未声明字段不会进入模型或 durable Step summary。
- [ ] 外部内容中的 prompt injection 文本只作为 Tool data 处理。
- [ ] Observation 同时受单条硬上限和本轮 Context budget 控制。
- [ ] Tool Call / Observation 不会被预算拆对。
- [ ] 成功、零结果、失败、timeout、超长和恶意内容均有自动化测试。
- [ ] 前端流式协议不暴露内部 Observation 或敏感 metadata。
- [ ] 用户能够解释 `data`、`modelContent`、Observation envelope 和 Step summary 的不同用途。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 通用 policy 不知道业务字段语义 | 工具自己做 allowlist projector，通用层只实施统一安全和预算规则 |
| 双重截断让内容不可读 | envelope 记录两个原因并保留确定性头尾预览；测试模型可见格式 |
| 误把 Tool 文本当系统指令 | provider adapter 使用合法 tool result role / item，不拼接到 system 文本 |
| 日志泄漏 | durable recorder 与 model projector 分离，测试禁止字段 |

## GitHub 交付记录

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
