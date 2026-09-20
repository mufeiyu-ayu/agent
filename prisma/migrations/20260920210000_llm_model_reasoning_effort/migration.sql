-- 模型行的默认 reasoning_effort；null 表示不发。可取值由 contracts 的 REASONING_EFFORTS_BY_FAMILY 按家族约束。
ALTER TABLE "LlmModel" ADD COLUMN "reasoningEffort" TEXT;

-- 此前 DeepSeek 家族固定发 reasoning_effort=high，回填保持行为不变。
UPDATE "LlmModel" AS m
SET "reasoningEffort" = 'high'
FROM "LlmProvider" AS p
WHERE p."id" = m."providerId" AND p."family" = 'deepseek';
