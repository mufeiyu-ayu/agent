ALTER TABLE "ConversationWorkspace"
  ADD COLUMN "webProject" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "artifactId" TEXT;

CREATE TABLE "WorkspaceArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sourceRevision" INTEGER NOT NULL,
  "command" TEXT NOT NULL,
  "files" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceArtifact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkspaceArtifact_conversationId_createdAt_idx" ON "WorkspaceArtifact"("conversationId", "createdAt");
