-- AlterTable
ALTER TABLE "Article" ADD COLUMN "languageCode" TEXT NOT NULL DEFAULT 'en';

-- Existing rows are updated by the idempotent seed. New rows must always provide a language code.
ALTER TABLE "Article" ALTER COLUMN "languageCode" DROP DEFAULT;
