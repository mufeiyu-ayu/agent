-- 删除 Phase 8 的文章向量索引（Issue #187）：ArticleChunk / ArticleIndexState 两张表，连同它们的索引与指向 Article 的级联外键。
-- 旧迁移 20260814090000_add_article_embedding_index 保留作历史，本迁移在其之后顺序执行；老数据不迁移。
-- 不删 vector 扩展：旧迁移从零建库时照样会创建它，数据库镜像无论如何都要带 pgvector。

-- DropTable
DROP TABLE IF EXISTS "ArticleChunk";
DROP TABLE IF EXISTS "ArticleIndexState";
