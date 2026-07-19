# Agent Console

`@agent/admin` 是面向 Agent Runtime 调试与观测的独立后台前端。Task 0 只提供静态基础壳，不连接后台 API。

## 本地运行

```bash
pnpm dev:admin
```

访问 <http://localhost:5174>。

## 当前边界

- 已提供 Overview、Runs、404、明暗主题、Sidebar 折叠与 Route Tabs。
- 主题和 Sidebar 折叠状态保存在浏览器 `localStorage`。
- 不包含登录、权限、动态路由、真实 Run 数据或查询 API。
