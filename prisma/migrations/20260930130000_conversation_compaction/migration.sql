-- 上下文自动压缩（Issue #220）：只加不删，回退到之前的代码照常运行（旧代码不读新列与新表，删会话时新表随之级联删除）。

-- 压缩时保留最近原文的 token 数：已有行取默认 20,000，其余列原样保留；范围与管理台表单校验一致。
ALTER TABLE "RuntimeConfig" ADD COLUMN "compactionKeepRecentTokens" INTEGER NOT NULL DEFAULT 20000;
ALTER TABLE "RuntimeConfig" ADD CONSTRAINT "RuntimeConfig_compaction_keep_recent" CHECK ("compactionKeepRecentTokens" BETWEEN 1000 AND 200000);

-- 历史压缩记录：每条自成完整（摘要恰好覆盖 coveredGroupIds），读历史时取 readAt 最新的一条。
CREATE TABLE "ConversationCompaction" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "coveredGroupIds" TEXT[],
    "answerOnlyGroupId" TEXT,
    "readAt" TIMESTAMP(3) NOT NULL,
    "tokensBefore" INTEGER NOT NULL,
    "usage" JSONB,
    "modelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationCompaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConversationCompaction_conversationId_readAt_idx" ON "ConversationCompaction"("conversationId", "readAt");

ALTER TABLE "ConversationCompaction" ADD CONSTRAINT "ConversationCompaction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationCompaction" ADD CONSTRAINT "ConversationCompaction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
