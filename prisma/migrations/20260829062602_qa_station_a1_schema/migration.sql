-- CreateEnum
CREATE TYPE "TranslationVerdict" AS ENUM ('PASS', 'REVIEW', 'REJECT');

-- CreateEnum
CREATE TYPE "TranslationReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "isPublished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isQaCandidate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT,
ADD COLUMN     "termHitCount" INTEGER;

-- CreateTable
CREATE TABLE "ArticleTranslation" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranslationScore" (
    "id" TEXT NOT NULL,
    "translationId" TEXT NOT NULL,
    "ruleScore" INTEGER,
    "judgeScore" INTEGER,
    "verdict" "TranslationVerdict",
    "reviewStatus" "TranslationReviewStatus" NOT NULL DEFAULT 'PENDING',
    "scoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Glossary" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Glossary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryTerm" (
    "id" INTEGER NOT NULL,
    "glossaryId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "GlossaryTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlossaryTermTranslation" (
    "id" INTEGER NOT NULL,
    "glossaryId" INTEGER NOT NULL,
    "termId" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "GlossaryTermTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTranslation_sourceId_key" ON "ArticleTranslation"("sourceId");

-- CreateIndex
CREATE INDEX "ArticleTranslation_languageCode_idx" ON "ArticleTranslation"("languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleTranslation_articleId_languageCode_key" ON "ArticleTranslation"("articleId", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "TranslationScore_translationId_key" ON "TranslationScore"("translationId");

-- CreateIndex
CREATE INDEX "TranslationScore_verdict_idx" ON "TranslationScore"("verdict");

-- CreateIndex
CREATE INDEX "TranslationScore_reviewStatus_idx" ON "TranslationScore"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Glossary_name_key" ON "Glossary"("name");

-- CreateIndex
CREATE INDEX "GlossaryTerm_glossaryId_idx" ON "GlossaryTerm"("glossaryId");

-- CreateIndex
CREATE INDEX "GlossaryTermTranslation_glossaryId_languageCode_idx" ON "GlossaryTermTranslation"("glossaryId", "languageCode");

-- CreateIndex
CREATE UNIQUE INDEX "GlossaryTermTranslation_termId_languageCode_key" ON "GlossaryTermTranslation"("termId", "languageCode");

-- CreateIndex
CREATE INDEX "Article_isQaCandidate_idx" ON "Article"("isQaCandidate");

-- AddForeignKey
ALTER TABLE "ArticleTranslation" ADD CONSTRAINT "ArticleTranslation_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranslationScore" ADD CONSTRAINT "TranslationScore_translationId_fkey" FOREIGN KEY ("translationId") REFERENCES "ArticleTranslation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryTerm" ADD CONSTRAINT "GlossaryTerm_glossaryId_fkey" FOREIGN KEY ("glossaryId") REFERENCES "Glossary"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlossaryTermTranslation" ADD CONSTRAINT "GlossaryTermTranslation_termId_fkey" FOREIGN KEY ("termId") REFERENCES "GlossaryTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
