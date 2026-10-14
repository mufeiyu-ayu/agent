# Google 数据连接配置

面向平台维护者。用户在「插件 → Google 数据」选择 GSC、GA4 或两者并授权，无需到 Cloud Console 创建项目或提供密钥。每个 Kuro 用户连接一个 Google 账号，资源权限来自这个账号在 GSC/GA4 的现有授权。

## 平台配置

1. 核对 Kuro 所属 Google Cloud 项目、Google Auth Platform 的 Branding、Audience、Data Access 与验证状态。不要把旧 gsc-insights Desktop 客户端转换或删除；新 Client ID 也不提供项目级 revoke 隔离。
2. 创建数据接入专用 **Web application** OAuth 客户端。生产和测试按 Google 规则使用对应环境的项目/客户端。应用资料应如实对应 Kuro 的域名、主页和 `/privacy`。
3. 为需要的服务启用 **Google Search Console API**、**Google Analytics Admin API**、**Google Analytics Data API**。仅请求 `webmasters.readonly`、`analytics.readonly`，账号展示需要 `openid email`；不申请写权限或 Gmail 等无关权限。
4. Authorized redirect URI 精确登记为 `APP_ORIGINS` 第一项加 `/api/google-data/oauth/callback`。例如生产为 `https://askkuro.com/api/google-data/oauth/callback`；开发使用实际前端代理地址，如 `http://localhost:5173/api/google-data/oauth/callback`。发起网页的 origin 必须与该回调 origin 一致，不能混用 localhost / 127.0.0.1。
5. 在后端安全配置 `GOOGLE_DATA_CLIENT_ID`、`GOOGLE_DATA_CLIENT_SECRET`，不填入前台、不提交 `.env`。沿用 `AGENT_SECRET_KEY` 加密入库；保留现有主密钥，修改会使已有密文无法解密。出站代理沿用 `OUTBOUND_PROXY_URL`，不自动读取 shell HTTP_PROXY。
6. 应用迁移通过既有发布机制执行；新增表不改变旧登录和 MCP 表。设置环境变量的生效、生产迁移和部署按项目发布与服务器授权规则操作，本 Issue 不包含生产部署。

未配置时卡片显示等待管理员配置。此处没有提供可直接复用的生产客户端密钥；禁止把旧 `.env` 或个人令牌迁入线上作为默认共享账号。

## 用户流程与验收

- 已登录 Kuro → 插件 → Google 数据 → 选择服务 → 连接 Google → Google 原生选择账号/同意 → 返回插件详情。
- 可以只授权其中一个服务；平台按实际授予权限显示服务。数据账号与 Kuro 登录账号可以不同，不会替换登录身份。
- 选择 GSC 站点后自动保存并验证；GA4 选择资源和 Web 数据流，确认域名为目标生产站点，选完整后一起自动保存并验证。保存时显示进度并防重复，保存失败恢复服务端确认的选择；保存成功但验证失败保留选择，仅重试验证。
- 验证成功代表这一时刻该账号能读取该资源；空数据不代表零流量。无站点或 403 时核对所选 Google 账号、资源权限及 API 是否启用；401/invalid_grant 时重新授权；429/服务异常稍后重试。
- 授权中返回网页可取消本次授权；过期/拒绝/会话改变不能完成绑定。重新授权成功前保留原连接，切换 Google 账号成功后须重新选择资源。
- 已连接时授权服务勾选收起，点击上方重新授权后展开；断开连接与授权按钮同一行，沿用 MCP 弹窗主/次按钮样式。资源打开时自动加载，失败提供重试，正常状态不显示独立保存、验证或刷新按钮。
- 断开删除本站令牌和选择，不删除旧聊天、不自动撤销 Google 项目授权。彻底撤销可前往 Google 账号连接设置，操作前留意对同 Cloud 项目其他客户端的影响。

真实验收必须记录所用环境、实际回调地址、服务及资源（不含令牌）、实际只读请求结果和检查时间。至少一个获准服务完成真实授权与验证；未配置、未完成 Google 人工登录或无资源权限时标未验证，不能用受控测试或截图中的客户端存在代替。正式开放还需核验 Google 应用发布/审核要求，不把 In production 解释为已通过验证。

## 隐私与边界

连接验证仅由 Kuro 后端请求 Google，不发给模型。后续分析功能需要把相关查询结果交给用户选择的模型服务商并随对话保存，必须与届时真实行为及隐私说明一致。聊天可使用 gsc_query、ga4_metadata、ga4_query 查询当前用户已选资源；平台不预设公司的事件/收入口径，不含公司专属分析 Skill。

官方依据：[Web OAuth 与离线授权](https://developers.google.com/identity/protocols/oauth2/web-server)、[部分授权](https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions)、[GSC 站点列表](https://developers.google.com/webmaster-tools/v1/sites/list)、[GA4 资源列表](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)、[应用验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)。


## 在聊天中使用

资源保存后可直接问“查询所选 GSC 站点某日期范围的点击和展示”或“查询所选 GA4 资源某日期范围的 sessions”。未知自定义字段先让模型读取字段元数据。工具不要求再次填写站点、property 或 stream ID，也不能从问题中覆盖它们。

结果会标注数据来源、日期和质量限制。同一次问答中切换资源、断开或重新授权后，旧查询会被拒绝；确认插件页选择后发起新问题即可。GSC URL 前缀资源与域名资源覆盖不同，选中 www 前缀所得的0不代表其他主机或整个域名为0。工具返回 Google 明确的0与没有返回行是两种事实。
