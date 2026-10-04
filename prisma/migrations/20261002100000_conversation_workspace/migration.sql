CREATE TABLE "ConversationWorkspace" (
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "files" JSONB NOT NULL DEFAULT '[]',
  "ownerRunId" TEXT,
  "leaseExpiresAt" TIMESTAMP(3),
  "sandboxId" TEXT,
  "state" TEXT NOT NULL DEFAULT 'idle',
  "lastOperation" TEXT,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationWorkspace_pkey" PRIMARY KEY ("conversationId"),
  CONSTRAINT "ConversationWorkspace_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConversationWorkspace_state_leaseExpiresAt_idx" ON "ConversationWorkspace"("state", "leaseExpiresAt");
CREATE INDEX "ConversationWorkspace_userId_idx" ON "ConversationWorkspace"("userId");
