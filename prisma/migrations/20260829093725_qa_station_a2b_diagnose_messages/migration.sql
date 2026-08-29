-- CreateEnum
CREATE TYPE "QaDiagnoseRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "QaDiagnoseMessage" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "role" "QaDiagnoseRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaDiagnoseMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QaDiagnoseMessage_articleId_createdAt_idx" ON "QaDiagnoseMessage"("articleId", "createdAt");

-- AddForeignKey
ALTER TABLE "QaDiagnoseMessage" ADD CONSTRAINT "QaDiagnoseMessage_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
