# 参照实现方法

## 1. 目标

这套方法给 AI 用：把 Pi 等参照物的做法转成当前项目的实现判断。主入口见 [pi-reference](README.md)，每次只针对 [roadmap](./roadmap.md) 中的一步。

用户不读 Pi 代码。AI 自行查素材、做对照；实现、测试与验收产物只在用户授权某一步时产生，不因"方法要求"自动改代码、创建 Task 或宣布验收。

## 2. 每步六问

### Step 1：写出本步问题

只允许一个主要问题，例如：

> 模型返回 Tool Call 后，系统如何执行工具并让模型继续回答？

如果问题同时包含 MCP、审批、多 Agent 和 UI，说明这步过大。

### Step 2：找当前项目真实入口

先看当前代码，不从理想架构开始。记录：

- 输入在哪里进入？
- 当前类型能表达什么？
- 当前副作用在哪里发生？
- 状态在哪里持久化？
- 失败如何收口？
- 有没有测试证明？

### Step 3：沿 Pi 的一条链核对

只读对当前问题直接有用的文件。跳过：与本段无关的语言和 SDK 细节、平台 sandbox 系统调用、UI 渲染特例、无关 feature flags。重点记录设计不变量，而不是复制函数签名。

### Step 4：做云端翻译

1. 参照物解决的约束在我们的云端场景是否存在？
2. 本地用户身份如何变成 server-side tenant scope？
3. 本地进程状态如何变成 durable state？
4. 本地 tool permission 如何变成业务授权与隔离？

### Step 5：Red

先写一种失败证据：类型无法表达目标事件；单元测试表明 mapper/router 不支持新输入；runtime fake integration test 失败；contract test 表明状态不一致；数据库测试表明事务不完整。

### Step 6：Green + Refactor

Green 只实现测试需要的最小行为。第二个工具、第二个 provider 或第二个入口出现前，不为想象中的扩展建立复杂抽象。Refactor 必须有现存重复或职责冲突作为证据。

## 3. 每步产物

- 一张最小调用链图（可复用 `diagrams/`）。
- 一组项目自有 TypeScript 类型。
- 一个 fake adapter 或 fake executor。
- 一条 happy path 测试。
- 一条 error/cancel path 测试。
- 一个验收记录。
- 下一步的前置条件。

## 4. 证据模板

```md
## 验收证据

- Requirement：Observation 必须进入第二轮模型请求。
- Test：`agent-runtime.service.spec.ts` 中的 xxx case。
- Runtime evidence：测试捕获的第二轮 messages 包含 callId=xxx。
- Result：PASS。
- Remaining risk：尚未验证真实 provider 多 chunk tool arguments。
```

## 5. 复盘模板（写进 PR / 任务记录，不是让用户答）

```md
### 这次从参照物借鉴的约束
### 当前项目没有照搬的部分及原因
### 仍不确定 / 未实测范围
### 下一步前置
```

## 6. 防止过度设计

- 一个工具时可以有 registry，但不要做动态插件发现。
- 一个 provider 时要有 adapter 边界，但不要做复杂 provider marketplace。
- 当前单实例时定义 durable cancel 语义，但不用立即引入分布式队列。
- 当前只读工具也定义 risk metadata，但不做完整 RBAC 控制台。
- Multi-agent 按项目约定后置，不因研究参照物具备该能力就自动开展实验或实现。

## 7. 一步完成的判断

1. 能在 Pi 找到真实源码证据，并指出当前项目对应边界。
2. 有最小实现，非平凡逻辑有相应检查证据；明确尚未实测的范围。
3. 有明确未做范围。
4. 下一步不依赖未验证假设。
5. 向用户汇报的只有结论、影响与需要他做的选择。
