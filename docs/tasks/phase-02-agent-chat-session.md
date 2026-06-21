# 阶段 2：Agent Chat Session + 数据持久化系统

## 阶段目标

把项目从“单页 Chat UI”升级为“多会话 + 可持久化 + Session 驱动”的 Agent Chat 系统。

这一阶段的重点是数据层，不是 UI 美化，也不是 Tool Calling。

完成后，系统应该做到：

- 支持多个 conversation
- 每个 conversation 有独立 messages
- 刷新页面后历史不丢
- Chat 请求基于 conversationId 运行
- 后端能根据 conversationId 构建受控上下文

## 本阶段核心认知

从：

```txt
UI state = 数据源
```

升级为：

```txt
DB / Storage = 数据源
UI = 展示层
```

这是 Agent 应用 Memory Layer 的第一步。

## 任务列表

### Task 1：定义 Conversation / Message 数据模型

#### 核心要完成

- 明确 Conversation 是一次独立对话
- 明确 Message 必须归属某个 Conversation
- 定义前后端统一的数据结构
- 为后续持久化、上下文构建、Streaming 预留必要字段

#### 建议最小模型

Conversation：

- id
- title
- createdAt
- updatedAt

Message：

- id
- conversationId
- role
- content
- status
- createdAt
- updatedAt

#### 验收条件

- 能清楚说明 conversation 和 message 的关系
- 每条 message 都能找到所属 conversation
- 前后端使用同一套核心字段理解数据

### Task 2：确定数据库持久化方案

#### 核心要完成

- 使用 PostgreSQL + Prisma 作为本阶段最终持久化方案
- 建立 Conversation / Message 的数据库模型
- 明确表关系、排序策略和删除策略
- 明确本阶段不把 localStorage 当成最终数据源

#### 推荐方案

```txt
NestJS
  ↓
Prisma ORM
  ↓
PostgreSQL
```

#### 核心关系

```txt
Conversation 1 -> N Message
```

#### 关键约束

- Conversation list 按 updatedAt 倒序
- Message list 按 createdAt 正序
- 删除 conversation 时，需要处理关联 messages
- 本阶段暂不做 User / Auth / Multi-tenant
- 本阶段暂不做向量数据库、Redis、软删除、全文搜索

#### 验收条件

- conversation 可以保存到数据库
- message 可以保存到数据库
- 重启前后端后数据仍可查询
- 数据库方案能支撑阶段 3 的 streaming 最终消息落库

### Task 3：实现 Conversation 基础 CRUD

#### 核心要完成

- 创建 conversation
- 查询 conversation list
- 切换 active conversation
- 删除 conversation
- 更新 conversation.updatedAt

#### 前端关注点

- sidebar 能展示 conversation list
- 能新建、切换、删除 conversation
- 空列表时有合理状态

#### 后端关注点

- 提供 conversation 创建、查询、删除接口
- 删除 conversation 时处理关联 messages
- 新消息产生后更新 conversation.updatedAt

#### 验收条件

- 可以创建多个 conversation
- 可以切换不同 conversation
- 删除 conversation 后 UI 能同步更新
- conversation list 按最近更新时间排序

### Task 4：实现 Message 持久化

#### 核心要完成

- 创建 user message
- 创建 assistant message
- 查询某个 conversation 下的 messages
- message 必须绑定 conversationId

#### 前端关注点

- 切换 conversation 时加载对应 messages
- 当前页面只展示 active conversation 的 messages
- 不再只靠前端数组保存消息

#### 后端关注点

- 写入 message 前校验 conversation 是否存在
- 查询 messages 时基于 conversationId
- messages 按 createdAt 正序返回

#### 验收条件

- 每条 message 都有 conversationId
- 切换 conversation 不会串消息
- 刷新页面后 messages 可以恢复
- 不存在的 conversationId 不能写入 message

### Task 5：改造前端 Chat 状态结构

#### 核心要完成

- 增加 activeConversationId
- conversation list 和 message list 分开管理
- message list 由 activeConversationId 驱动
- 发送消息时携带 conversationId

#### 关键约束

- 不做大规模 UI 重构
- 不为了拆而拆 composable
- 不让多个组件各自维护一份 messages

#### 验收条件

- 前端有明确的 activeConversationId
- 当前 message list 来自当前 conversation
- 切换 conversation 不会串消息
- 刷新后能恢复默认或最近 conversation

### Task 6：Session 驱动 Chat Flow

#### 核心要完成

- Chat 请求必须携带 conversationId
- 后端根据 conversationId 加载历史 messages
- 后端组装 LLM messages
- 调用 LLM 后保存 assistant message
- 返回最终 assistant message 给前端

#### 核心流程

```txt
用户输入
  ↓
保存 user message
  ↓
加载 conversation history
  ↓
组装 LLM messages
  ↓
调用 LLM
  ↓
保存 assistant message
  ↓
返回前端展示
```

#### 验收条件

- 每次 Chat 请求都绑定 conversationId
- user message 和 assistant message 都能持久化
- 第二轮对话可以引用上一轮信息
- conversation.updatedAt 会随新消息更新

### Task 7：控制 History 成本

#### 核心要完成

- 只取最近 N 轮 user / assistant messages
- 明确 history 截断规则
- 保证当前用户问题一定进入上下文
- 不把全部历史无脑传给模型

#### 关键约束

- 不做 embedding memory
- 不做 summary memory
- 不做长期记忆
- 不做复杂 token 估算器

#### 验收条件

- 历史很长时，不会全部传给 LLM
- 最近几轮上下文能正常生效
- 当前问题一定参与本次模型调用
- history 规则能在代码中明确找到

### Task 8：阶段 2 回归验收

#### 核心要完成

验证多会话、持久化和 session Chat Flow 是一个完整闭环。

#### 验收路径

1. 创建 conversation A 并发送多轮消息
2. 创建 conversation B 并确认不串消息
3. 切回 conversation A 并确认历史仍在
4. 刷新页面并确认数据仍在
5. 删除 conversation 并确认消息同步处理
6. 确认长历史不会全部传给模型

#### 最终验收条件

- 可以创建多个 conversation
- 可以在 sidebar 切换 conversation
- 每个 conversation 展示自己的 messages
- 刷新页面后数据不丢
- Chat 请求包含 conversationId
- 后端能基于 conversationId 构建受控上下文
- 第二轮对话可以引用上一轮信息

## 本阶段不做

- Stream 输出
- Tool Calling
- Agent Runtime
- Agent Step System
- RAG
- Long-term Memory
- Multi-agent
- 外部搜索
- 复杂工作流
- 生产级权限系统

## 完成后的下一阶段

进入阶段 3：流式输出 + ChatGPT 级交互体验。
