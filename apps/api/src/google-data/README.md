# Google 数据个人连接

入口 `/api/google-data`，前台在插件系统目录的「Google 数据」。`GoogleDataService` 负责个人授权、加密凭据、资源选择与验证；`GoogleDataClient` 仅向固定 Google HTTPS 端点请求，有超时、响应大小和分页上限。它不走 MCP 协议，也不参与 Google 登录账号绑定。

- 每个 Kuro 用户一个 Google 数据账号；GSC/GA4 按实际返回 scopes 开放。Google 数据账号可以与登录邮箱不同。
- `connect` 生成 state + PKCE，回调绑定当前用户与 Session，state 一次消费且十分钟到期；独立 Web 客户端配置指纹防止应用配置更换后复用旧令牌。
- 刷新令牌与 access token 加密存储，接口只返回账号、权限状态与选择。单 API 实例合并刷新；多副本前需数据库互斥。
- revision 阻止迟到授权、刷新、选择与查询覆盖新连接或断开。重授权失败保留旧连接；换 Google 账号成功后清空旧资源，不能继承旧账号刷新令牌。
- GSC 站点、GA4 资源及 Web 数据流都通过 Google 列表核验，浏览器不能代替服务端决定归属。GA4 验证强制 streamId 过滤，界面由用户确认生产流；不硬编码 Topuplist ID。
- 验证请求绑定页面持有的 revision，多标签页改资源后旧页面不能显示另一资源的验证成功。验证只读取有界报告：GSC 前 10 至前 3 天 final、最多一行；GA4 最近 7 天至昨天、最多一行。不返回分析结论，空行不解释为零流量，也不将验证结果发送给模型。
- `disconnect` 删除本站凭据和资源选择，保留 revision；不自动调用 Google revoke。Google 撤销可能影响该用户在同一 Cloud 项目所有客户端的授权，界面提供 Google 端管理链接并说明差异。已有聊天记录不随断开删除。
- 错误仅返回稳定安全原因，不暴露 Google 原始错误、授权码或令牌。401/invalid_grant 标需重连；403 说明资源权限/API 配置，429/5xx 不误报授权成功。

部署配置、控制台步骤与真实验收见 [Google 数据连接配置](../../../../docs/google-data-connection.md)。本轮没有聊天工具、Skill 或公司共享连接。

验证：`google-data-client.test.ts`（固定出口/响应边界）、`google-data.db.test.ts`（真实隔离 PostgreSQL + 受控 HTTP OAuth/API、鉴权/校验/故障竞争）、`apps/web/e2e/google-data.spec.ts`（受控浏览器交互）。这些不代替真实 Google 授权与资源权限验收。
