-- CreateTable
CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "apiKeyLast4" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "wireName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contextWindowTokens" INTEGER NOT NULL,
    "maxOutputTokens" INTEGER NOT NULL,
    "reasoning" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "lastProbeOk" BOOLEAN,
    "lastProbeError" TEXT,
    "lastProbedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmModel_visible_sortOrder_idx" ON "LlmModel"("visible", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LlmModel_providerId_wireName_key" ON "LlmModel"("providerId", "wireName");

-- AddForeignKey
ALTER TABLE "LlmModel" ADD CONSTRAINT "LlmModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LlmProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

