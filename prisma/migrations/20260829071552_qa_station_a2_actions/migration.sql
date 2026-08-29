-- CreateEnum
CREATE TYPE "TranslationTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "TranslationScore" ADD COLUMN     "lengthRatio" DOUBLE PRECISION,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TranslationTask" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL,
    "status" "TranslationTaskStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationTask_articleId_languageCode_idx" ON "TranslationTask"("articleId", "languageCode");

-- CreateIndex
CREATE INDEX "TranslationTask_status_idx" ON "TranslationTask"("status");

-- AddForeignKey
ALTER TABLE "TranslationTask" ADD CONSTRAINT "TranslationTask_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
