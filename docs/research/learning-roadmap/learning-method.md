# 分阶段学习方法

## 1. 目标

这套方法用于保证“学习 Codex 架构”最终能转化为当前项目能力，而不是停留在看懂源码或复制类型名。

## 2. 每阶段七步法

### Step 1：写出阶段问题

只允许一个主要问题，例如：

> 模型返回 Tool Call 后，系统如何执行工具并让模型继续回答？

如果问题同时包含 MCP、审批、多 Agent 和 UI，说明阶段过大。

### Step 2：找当前项目真实入口

先看当前代码，不从理想架构开始。记录：

- 输入在哪里进入？
- 当前类型能表达什么？
- 当前副作用在哪里发生？
- 状态在哪里持久化？
- 失败如何收口？
- 有没有测试证明？

### Step 3：沿 Codex 一条链阅读

只读对当前问题直接有用的文件。第一遍跳过：

- Rust 生命周期和宏细节。
- 平台 sandbox 系统调用。
- UI 渲染特例。
- 与当前问题无关的 feature flags。

重点记录设计不变量，而不是复制函数签名。

### Step 4：做云端翻译

使用四问：

1. Codex 解决的约束在云端是否存在？
2. 本地用户身份如何变成 server-side tenant scope？
3. 本地进程状态如何变成 durable state？
4. 本地 tool permission 如何变成业务授权与隔离？

### Step 5：Red

优先写以下一种失败证据：

- 类型无法表达目标事件。
- 单元测试表明 mapper/router 不支持新输入。
- runtime fake integration test 失败。
- contract test 表明状态不一致。
- 数据库测试表明事务不完整。

### Step 6：Green + Refactor

Green 只实现测试需要的最小行为。第二个工具、第二个 provider 或第二个入口出现前，不为想象中的扩展建立复杂抽象。

Refactor 必须有现存重复或职责冲突作为证据。

### Step 7：Teach-back

阶段完成时，不看文档回答：

- 入口到最终结果的调用链。
- 至少三个状态变化。
- 一个失败路径。
- 一个为什么没有照搬 Codex 的取舍。
- 哪个测试最能证明闭环。

## 3. 统一阶段产物

每个阶段至少留下：

- 一张最小调用链图。
- 一组项目自有 TypeScript 类型。
- 一个 fake adapter 或 fake executor。
- 一条 happy path 测试。
- 一条 error/cancel path 测试。
- 一个阶段验收记录。
- 下一阶段的前置条件。

## 4. 证据模板

```md
## 验收证据

- Requirement：Observation 必须进入第二轮模型请求。
- Test：`agent-runtime.service.spec.ts` 中的 xxx case。
- Runtime evidence：测试捕获的第二轮 messages 包含 callId=xxx。
- Result：PASS。
- Remaining risk：尚未验证真实 provider 多 chunk tool arguments。
```

## 5. 复盘模板

```md
### 我现在能解释

- ...

### 我仍不确定

- ...

### 这次从 Codex 学到的约束

- ...

### 当前项目没有照搬的部分

- ...

### 下一阶段前置

- ...
```

## 6. 防止过度设计

- 一个工具时可以有 registry，但不要做动态插件发现。
- 一个 provider 时要有 adapter 边界，但不要做复杂 provider marketplace。
- 当前单实例时定义 durable cancel 语义，但不用立即引入分布式队列。
- 当前只读工具也定义 risk metadata，但不做完整 RBAC 控制台。
- Multi-agent 先做离线实验，不直接进入产品主线。

## 7. 学习完成的判断

学习阶段完成不是“文档读完”，而是同时满足：

1. 概念可以用自己的语言解释。
2. 能在 Codex 找到真实源码证据。
3. 能指出当前项目对应边界。
4. 有最小实现或实验。
5. 有自动化测试。
6. 有明确未做范围。
7. 下一阶段不会依赖未验证假设。
