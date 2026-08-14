-- Task 1 requires pgvector. If the extension is unavailable, migration fails
-- explicitly instead of creating a non-vector fallback column.
BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "ArticleChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "sectionPath" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embeddingInputHash" TEXT NOT NULL,
    "chunkerVersion" TEXT NOT NULL,
    "embeddingProvider" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingDimensions" INTEGER NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleChunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ArticleChunk_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "ArticleChunk_tokenCount_check" CHECK ("tokenCount" BETWEEN 1 AND 800),
    CONSTRAINT "ArticleChunk_embeddingDimensions_check" CHECK ("embeddingDimensions" = 1536)
);

-- CreateTable
CREATE TABLE "ArticleIndexState" (
    "articleId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "chunkerVersion" TEXT NOT NULL,
    "embeddingVersion" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleIndexState_pkey" PRIMARY KEY ("articleId"),
    CONSTRAINT "ArticleIndexState_chunkCount_check" CHECK ("chunkCount" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleChunk_articleId_ordinal_key" ON "ArticleChunk"("articleId", "ordinal");

-- CreateIndex
CREATE INDEX "ArticleChunk_articleId_chunkerVersion_embeddingVersion_idx" ON "ArticleChunk"("articleId", "chunkerVersion", "embeddingVersion");

-- CreateIndex
CREATE INDEX "ArticleChunk_languageCode_idx" ON "ArticleChunk"("languageCode");

-- CreateIndex
CREATE INDEX "ArticleChunk_embeddingVersion_idx" ON "ArticleChunk"("embeddingVersion");

-- CreateIndex
CREATE INDEX "ArticleIndexState_chunkerVersion_embeddingVersion_idx" ON "ArticleIndexState"("chunkerVersion", "embeddingVersion");

-- AddForeignKey
ALTER TABLE "ArticleChunk" ADD CONSTRAINT "ArticleChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleIndexState" ADD CONSTRAINT "ArticleIndexState_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
