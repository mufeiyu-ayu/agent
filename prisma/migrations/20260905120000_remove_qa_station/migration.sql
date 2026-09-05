-- 删除翻译质检站（Issue #109 / #111）引入的数据模型（Issue #113）。
-- 先删子表再删父表；旧的 4 条 qa 迁移保留作历史，本迁移在其之后顺序执行。

-- DropTable（子表 -> 父表）
DROP TABLE IF EXISTS "TranslationScore";
DROP TABLE IF EXISTS "ArticleTranslation";
DROP TABLE IF EXISTS "TranslationTask";
DROP TABLE IF EXISTS "QaDiagnoseMessage";
DROP TABLE IF EXISTS "GlossaryTermTranslation";
DROP TABLE IF EXISTS "GlossaryTerm";
DROP TABLE IF EXISTS "Glossary";

-- DropEnum
DROP TYPE IF EXISTS "TranslationVerdict";
DROP TYPE IF EXISTS "TranslationReviewStatus";
DROP TYPE IF EXISTS "TranslationTaskStatus";
DROP TYPE IF EXISTS "QaDiagnoseRole";

-- Article 上由质检站追加的 5 个字段与索引（summary 同样来自 A-1 迁移，无代码读写）
DROP INDEX IF EXISTS "Article_isQaCandidate_idx";
ALTER TABLE "Article"
  DROP COLUMN IF EXISTS "summary",
  DROP COLUMN IF EXISTS "isPublished",
  DROP COLUMN IF EXISTS "publishedAt",
  DROP COLUMN IF EXISTS "isQaCandidate",
  DROP COLUMN IF EXISTS "termHitCount";
