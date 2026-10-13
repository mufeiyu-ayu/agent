# MCP 插件

平台目录和个人配置在 `McpPlugin`；用户的启用状态、加密凭据、工具目录与一次授权身份在 `McpConnection`。系统条目不持有共享用户 API Key。图标是有界 PNG data URL，随配置原子替换，不产生 OSS 对象。

| 入口 | 职责 |
| --- | --- |
| `mcp.controller.ts` | `/api/mcp` 的私人配置/连接/导入，`/api/admin/mcp` 的系统目录与当前管理员连接测试。OAuth 回调仍要求当前用户登录。 |
| `mcp.service.ts` | 归属校验、配置与连接存储、OAuth provider、每用户的本轮工具集合；调用前复核连接 revision 和启停。 |
| `mcp-client.ts` | 官方 SDK 的连接/目录/调用适配、参数与结果边界；未实现的 client capabilities 不声明。 |
| `mcp-network.ts` | HTTPS 公网出口；MCP 与 OAuth 请求均阻止重定向，响应有上限。直连在实际连接时校验 DNS；本地配置出站代理时 CONNECT 固定为已校验 IP，Host/TLS 身份仍为原域名。 |
| `mcp-config.ts` | URL、请求头、PNG 图标和 JSON 导入的业务校验。 |

前台支持系统/个人列表、连接、启停、断开、私人配置与导入。后台只管理系统目录。OAuth 应用的配置不是用户 token；前台显示的详情不含保存的完整凭据。授权依赖服务商应用注册；Google 文档 MCP 的默认条目使用个人 API Key，管理员可配置 OAuth 应用后切换认证方式。

运行时在 ChatService 创建消息前按用户取实际工具目录，预算预检与模型使用同一集合。工具加入宿主的本轮 Map，不放进全局静态 Registry；仍走 ToolInvocation 参数校验、取消、观察值截断和 Step 提交。采样 Step 的 `input.mcp` 保存当次插件身份、模型工具名、原始远端名、说明和参数规格，不保存凭据。成功工具 display.title 供聊天展示插件与工具名。

连接初始化与配置写入在同一插件行锁内读取身份；前台连接携带该次身份配置的摘要，旧界面不能把凭据提交给变更后的服务。停用保留凭据，断开清空本站凭据；两者均提升 revision，使迟到刷新/授权不能再次发布。刷新在当前单 API 实例内串行；增加部署副本前需要数据库级互斥。删除本站凭据不表示服务商 token 已撤销。已发出的远端写入不能因本地取消而视为回滚，也不对结果未知的写操作自动重试。

首版只支持远端 Streamable HTTP、文本及结构化 JSON；不支持 stdio、旧 SSE transport、自动抓取资源链接与任意外部 HTML。目录每插件最多 100 个工具/10 页/200 KB，本人启用插件最多 10 个；参数规格有大小和深度限制，不支持外部/递归/动态引用、嵌套 schema 身份或正则表达式规格，不能跳过校验后执行。

验证：`mcp-config.test.ts` / `mcp-network.test.ts` 为模拟依赖边界；`mcp.db.test.ts` 为真实隔离 PostgreSQL + 受控 HTTP MCP/OAuth；`mcp.live.db.test.ts` 仅在显式 `MCP_LIVE_VALIDATION=1` 且临时提供 `MCP_GOOGLE_API_KEY` 时运行真实 Google / 模型验证，普通测试不消耗公网配额。真实浏览器 OAuth 与生产应用发布条件需另行核对，不能以受控服务代替。

`plugin-selection.ts` 生成显式选择指示及历史选择事实；ChatService 用本轮有效工具目录校验插件 ID，不信任前端名称。Message.plugins 保存 id/name，采样另存指示原文，旧选择不授予新权限。

系统目录初始包含 Google 开发文档、GitHub、Cloudflare、Gmail；新增目录不代替用户授权。GitHub/Gmail 的静态 OAuth 应用缺失会返回 setupMessage 并在建连接前拒绝。Gmail 的 Workspace Developer Preview/API 开通条件须由平台核实。
