# AI SEO Agent 助手项目规划

## 项目目标

做一个小型 AI SEO Agent 助手，用来把当前学习过的 LLM API、`messages`、JSON Output、Streaming、Tool Calls、NestJS 和前端页面串成一个可运行的小产品。

第一版目标不是做完整商业系统，而是跑通一个清晰的 Agent 产品闭环：

```txt
用户输入页面主题
  -> 后端调用 DeepSeek 生成 SEO 文案
  -> 代码校验模型输出
  -> 必要时调用本地 SEO 检查工具
  -> 返回 title / description / 检查结果
  -> 前端展示结果
```

## 产品定位

用户输入一个页面主题或商品信息，系统生成英文 SEO 内容，并给出基础检查结果。

示例输入：

```txt
页面主题：PUBG UC 充值页面
目标语言：英文
关键词：PUBG UC, top up, instant delivery
```

示例输出：

```json
{
  "title": "Buy PUBG UC Online - Fast & Secure Top Up",
  "description": "Top up PUBG UC instantly with secure payment and fast delivery.",
  "checks": {
    "titleLengthOk": true,
    "descriptionLengthOk": true,
    "keywordIncluded": true
  }
}
```

## 第一版功能边界

- 前端只做一个简单页面：输入页面主题，点击按钮，展示生成结果。
- 后端使用 NestJS 提供一个最小 API。
- 模型调用继续使用 DeepSeek OpenAI-compatible API。
- 先不接数据库，不做登录，不做复杂权限。
- SEO 检查工具先用本地函数实现，不调用外部服务。
- Streaming 可以作为后续增强，不强制放进第一版。

## 建议技术结构

```txt
NestJS Backend
  Controller
    -> 接收前端请求

  Service
    -> 组织 SEO 生成流程

  LLM Service
    -> 封装 DeepSeek 调用

  SEO Tool
    -> 检查 title / description 长度和关键词

Vue Frontend
  -> 输入页面主题
  -> 调用 Nest API
  -> 展示生成结果和检查状态
```

## 第二阶段学习重点

这个项目主要用于学习 Agent 执行机制，而不是单纯写页面。

重点概念：

- HTTP API 如何包住模型调用
- JSON Output 如何变成业务对象
- 模型输出为什么需要运行时校验
- Tool Calls 和本地工具函数如何结合
- 工具结果如何影响最终输出
- 后端如何处理模型调用错误
- 前端如何展示 AI 生成中的状态

## 推荐实现步骤

1. 搭建最小 NestJS 服务。
2. 新增 `POST /seo/generate` 接口。
3. 接口接收 `pageTopic`。
4. 调用 DeepSeek 生成 JSON SEO 文案。
5. 校验返回对象是否包含 `title` 和 `description`。
6. 调用本地 SEO 检查函数。
7. 返回生成内容和检查结果。
8. 搭建最小 Vue 页面调用接口。
9. 再考虑 Streaming 或自动重试。

## 暂不处理

- 用户登录
- 数据库存储
- 复杂 SEO 评分系统
- 多 Agent 协作
- RAG
- 外部搜索 API
- 部署

这些可以等最小闭环跑通后再逐步加入。
