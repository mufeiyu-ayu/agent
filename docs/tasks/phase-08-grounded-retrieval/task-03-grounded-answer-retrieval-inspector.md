# Phase 8 Task 3：Grounded Answer 与 Retrieval Inspector

状态：**Planned / 未启动**。

## 目标

建立回答来源引用和 Retrieval 可观察闭环，让 Web Chat 展示来源，让 Admin 展示安全的检索决策元数据。

## 前置条件

- Task 2 已完成 Hybrid Retrieval；
- Retrieval Result 已具备稳定 source / chunk identity；
- Phase 7 已提供安全 Context Inspector 基线。

## 计划范围

- 定义结构化来源引用 contract；
- 将回答引用绑定到本次 Retrieval 的 source / chunk；
- 在 Web Chat 展示来源卡片；
- 在 Admin Run Detail 展示 strategy、version、候选数、选入数和 outcome；
- 覆盖无结果、来源不足、兼容状态和错误状态；
- 建立 API、Read Model、前端交互与浏览器验收证据。

## Issue 创建前必须定案

1. 外部协议与旧客户端兼容方式；
2. 可展示的 source / chunk 字段；
3. 来源交互和页面结构；
4. 证据不足时的回答行为；
5. durable metadata 的存储和安全投影；
6. 是否在启动前拆分后端与 UI / Inspector 工作。

## 不做什么

- 不展示完整 Prompt、reasoning、原始 Embedding 或完整正文；
- 不做文件上传、通用知识库、多租户权限或外部连接器；
- 不做多 Agent、复杂检索规划或 Context replay。

## 预期验收方向

- 回答引用可映射到本次 Retrieval 的 source / chunk；
- 无结果与来源不足行为明确；
- Web 与 Admin 的 loading、error、legacy 和 partial 状态可验证；
- Context Budget、Tool pairing 和 Run terminalization 不退化；
- 自动测试与真实浏览器证据共同证明端到端闭环。

## GitHub 交付状态

- Issue：未创建
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行

## 任务状态

```text
规划状态：Planned
实施状态：未开始
验收状态：未验收
```

Task 3 依赖 Task 2，当前不得启动。