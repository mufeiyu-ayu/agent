ALTER TABLE "WorkspaceArtifact" ADD COLUMN "retiredAt" TIMESTAMP(3), ADD COLUMN "previewExpiresAt" TIMESTAMP(3);
-- 升级前的能力未持久化；保守保护一整个原有能力窗口。旧 API 必须退出后才启用 GC。
UPDATE "WorkspaceArtifact" a SET "retiredAt" = CURRENT_TIMESTAMP, "previewExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
WHERE NOT EXISTS (SELECT 1 FROM "ConversationWorkspace" w WHERE w."conversationId" = a."conversationId" AND w."artifactId" = a.id);

CREATE TABLE "WorkspaceGcTarget" (
  "conversationId" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "deletingKey" TEXT,
  "deleteId" TEXT,
  "deleteState" TEXT,
  "pending" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WorkspaceGcTarget_pending_idx" ON "WorkspaceGcTarget"("pending");

CREATE TABLE "WorkspaceUpload" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "state" TEXT NOT NULL DEFAULT 'active',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3)
);
CREATE INDEX "WorkspaceUpload_conversationId_state_idx" ON "WorkspaceUpload"("conversationId", "state");
