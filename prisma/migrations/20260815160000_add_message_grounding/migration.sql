-- Phase 8 Task 3A：assistant Message 的一对一 Grounding 事实。
-- 纯新增：不修改、不删除、不重置任何既有表或数据。

-- CreateTable
CREATE TABLE "MessageGrounding" (
    "messageId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "evidenceAvailability" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "citationIntegrity" TEXT NOT NULL,
    "faithfulnessStatus" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageGrounding_pkey" PRIMARY KEY ("messageId")
);

-- AddForeignKey
ALTER TABLE "MessageGrounding" ADD CONSTRAINT "MessageGrounding_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
