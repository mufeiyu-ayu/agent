-- 清理需求代次：旧扫描只能确认自己开始时看到的需求，不能取消后来登记的需求。
ALTER TABLE "WorkspaceGcTarget" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 1;
