-- null 归属专用于公共技能；个人接口仍按认证用户 ID 限定写入。
ALTER TABLE "Skill" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "SkillContent" ALTER COLUMN "userId" DROP NOT NULL;

-- 初始内容来自随代码提供的默认包；首次编辑才保存 OSS 对象，之后不覆盖管理员修改。
INSERT INTO "Skill" ("id", "userId", "publishedId", "enabled", "createdAt", "updatedAt")
VALUES ('builtin:skill-creator', NULL, 'builtin:skill-creator', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
