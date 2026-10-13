CREATE TABLE "McpPlugin" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL, "url" TEXT NOT NULL, "icon" TEXT,
  "authType" TEXT NOT NULL, "headerNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "oauthClientId" TEXT NOT NULL DEFAULT '', "oauthClientSecret" TEXT,
  "oauthScopes" TEXT NOT NULL DEFAULT '', "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpPlugin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "McpPlugin_userId_idx" ON "McpPlugin"("userId");
CREATE TABLE "McpConnection" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "pluginId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false, "connected" BOOLEAN NOT NULL DEFAULT false,
  "needsAuth" BOOLEAN NOT NULL DEFAULT false, "revision" INTEGER NOT NULL DEFAULT 0,
  "credentials" TEXT, "tools" JSONB NOT NULL DEFAULT '[]', "authState" TEXT,
  "authExpiresAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "McpConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "McpConnection_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "McpPlugin"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "McpConnection_userId_pluginId_key" ON "McpConnection"("userId", "pluginId");
CREATE UNIQUE INDEX "McpConnection_authState_key" ON "McpConnection"("authState");
INSERT INTO "McpPlugin" ("id", "name", "description", "url", "authType", "headerNames", "updatedAt")
VALUES ('google-developer-knowledge', 'Google 开发文档', '搜索和阅读 Google 官方开发文档，查询 API 用法与开发指南。', 'https://developerknowledge.googleapis.com/mcp', 'headers', ARRAY['X-Goog-Api-Key'], CURRENT_TIMESTAMP);
