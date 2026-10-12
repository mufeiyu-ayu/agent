-- 固定对象覆盖上传期间保留清理依据，迟到上传完成前不可回收或再次覆盖。
ALTER TABLE "SkillContent" ADD COLUMN "uploadId" TEXT;
