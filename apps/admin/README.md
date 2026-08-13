# Agent Console

`@agent/admin` 是面向 Agent Runtime 调试与观测的独立后台前端，通过 Nest Admin API 读取安全投影后的真实 Run / Step 数据。

## 本地运行

```bash
pnpm dev:admin
```

访问 <http://localhost:5174>。

## 当前边界

- 已提供 Overview、Run List / Detail、Execution Timeline、Typed / Generic Inspector、Context Inspector、404、明暗主题、Sidebar 折叠与 Route Tabs。
- Context Inspector 只展示每轮 sampling 的预算、来源、History / Observation 调整与结果，不展示完整 Prompt、reasoning 或 Tool payload。
- 主题和 Sidebar 折叠状态保存在浏览器 `localStorage`。
- 不包含登录、权限、动态路由或 Admin Task 4 Auth / RBAC。
