INSERT INTO "McpPlugin" ("id", "name", "description", "url", "authType", "oauthScopes", "updatedAt") VALUES
('github', 'GitHub', '查询和管理代码仓库、Issue 与 Pull Request。由平台配置 OAuth 应用后，使用你的 GitHub 账号授权。', 'https://api.githubcopilot.com/mcp/', 'oauth', 'repo read:org', CURRENT_TIMESTAMP),
('cloudflare', 'Cloudflare', '连接你的 Cloudflare 账号，查询和管理 DNS、Workers、R2 等服务，授权时选择允许访问的权限。', 'https://mcp.cloudflare.com/mcp', 'oauth', '', CURRENT_TIMESTAMP),
('gmail', 'Gmail', '搜索和阅读邮件、创建草稿及管理标签。Google 官方 MCP 当前要求 Workspace Developer Preview 资格，由平台配置 OAuth 应用。', 'https://gmailmcp.googleapis.com/mcp/v1', 'oauth', 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
