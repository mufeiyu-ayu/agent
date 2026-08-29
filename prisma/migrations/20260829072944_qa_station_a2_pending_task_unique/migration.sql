-- 同文章同语种最多一条 PENDING 任务：为幂等入队提供数据库级兜底，
-- 消除应用层 findFirst-then-create 的并发竞态。
-- 部分唯一索引 Prisma schema 无法表达，故以 raw SQL 维护。
CREATE UNIQUE INDEX "TranslationTask_pending_unique"
  ON "TranslationTask" ("articleId", "languageCode")
  WHERE "status" = 'PENDING';
