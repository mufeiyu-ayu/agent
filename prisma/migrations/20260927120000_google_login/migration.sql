-- Issue #198：Google 登录、待审核、昵称与头像。只加不删，回退到旧版本仍能启动运行；
-- 但旧版本不认识待审核（在它的用户列表里显示为正常），回退期间不要对待审核账号重置密码或改动。

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;
ALTER TABLE "User" ADD COLUMN "name" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "pendingApproval" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
