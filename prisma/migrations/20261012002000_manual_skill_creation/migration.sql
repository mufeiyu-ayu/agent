-- 手动创建的技能没有来源会话。
ALTER TABLE "Skill" ALTER COLUMN "conversationId" DROP NOT NULL;
