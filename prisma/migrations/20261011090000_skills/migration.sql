CREATE TABLE "Skill" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "draftId" TEXT, "publishedId" TEXT,
 "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Skill_userId_deletedAt_idx" ON "Skill"("userId", "deletedAt");
CREATE TABLE "SkillContent" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "skillId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "description" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "objectKey" TEXT NOT NULL, "bucket" TEXT NOT NULL, "bytes" INTEGER NOT NULL,
 "adopted" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SkillContent_adopted_createdAt_idx" ON "SkillContent"("adopted", "createdAt");
CREATE INDEX "SkillContent_skillId_idx" ON "SkillContent"("skillId");
