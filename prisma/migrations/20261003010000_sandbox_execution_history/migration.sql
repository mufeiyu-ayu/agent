CREATE TABLE "SandboxExecution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "apiHost" TEXT NOT NULL,
    "sandboxId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'creating',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "durationMs" BIGINT,
    "checkedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SandboxExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SandboxExecution_sandboxId_key" ON "SandboxExecution"("sandboxId");
CREATE INDEX "SandboxExecution_requestedAt_idx" ON "SandboxExecution"("requestedAt");
CREATE INDEX "SandboxExecution_state_requestedAt_idx" ON "SandboxExecution"("state", "requestedAt");
CREATE INDEX "SandboxExecution_userId_requestedAt_idx" ON "SandboxExecution"("userId", "requestedAt");
CREATE INDEX "SandboxExecution_runId_idx" ON "SandboxExecution"("runId");
