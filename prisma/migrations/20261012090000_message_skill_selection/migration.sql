ALTER TABLE "Message" ADD COLUMN "skills" JSONB NOT NULL DEFAULT '[]';

-- 迁移已有展示事实，不从当前技能名称反查或重新授予权限。
UPDATE "Message" m SET "skills" = previous.skills
FROM (
  SELECT DISTINCT ON (r."userMessageId") r."userMessageId", (
    SELECT jsonb_agg(jsonb_build_object('id', entry ->> 'id', 'name', entry ->> 'name'))
    FROM jsonb_array_elements(s."input" -> 'skills' -> 'entries') entry
    WHERE (s."input" -> 'skills' -> 'selectedIds') ? (entry ->> 'id')
  ) AS skills
  FROM "AgentRun" r JOIN "AgentStep" s ON s."runId" = r.id
  WHERE s.type = 'model_sampling' AND jsonb_typeof(s."input" -> 'skills' -> 'entries') = 'array'
  ORDER BY r."userMessageId", r."createdAt", s.sequence
) previous
WHERE m.id = previous."userMessageId" AND previous.skills IS NOT NULL AND m.role = 'USER';
