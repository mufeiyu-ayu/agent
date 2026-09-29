-- 模型的单次输入上限（Issue #216）：替换代码里写死的 262,144。
-- 已有行取迁移前运行时算出的输入预算 min(262144, 窗口 − 输出上限 − 16384)，迁移前后同一请求的预算不变；
-- 窗口放不下的行（运行时本来就会失败）按 1 记，保存时再由管理台校验。新行一律显式写入，不留默认值。
ALTER TABLE "LlmModel" ADD COLUMN "maxInputTokens" INTEGER NOT NULL DEFAULT 262144;
UPDATE "LlmModel"
SET "maxInputTokens" = LEAST(262144, GREATEST(1, "contextWindowTokens" - "maxOutputTokens" - 16384));
ALTER TABLE "LlmModel" ALTER COLUMN "maxInputTokens" DROP DEFAULT;

-- 运行配置（Issue #216）：只有一行，取值等于原环境变量的默认值，Serper Key 为空，在管理台填写。
CREATE TABLE "RuntimeConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxSamplingRounds" INTEGER NOT NULL,
    "maxToolCalls" INTEGER NOT NULL,
    "runDeadlineMs" INTEGER NOT NULL,
    "historyCandidateHardLimit" INTEGER NOT NULL,
    "debugCaptureModelIo" BOOLEAN NOT NULL,
    "serperApiKeyEncrypted" TEXT,
    "serperApiKeyLast4" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeConfig_pkey" PRIMARY KEY ("id"),
    -- 单行表：任何写入都落在 id = 1 这一行，不会出现第二行。
    CONSTRAINT "RuntimeConfig_single_row" CHECK ("id" = 1),
    -- 与接口校验同一组范围（contracts 的 RUNTIME_CONFIG_LIMITS）：绕过管理台直接写库也写不进坏值，运行时读到的一定合法。
    CONSTRAINT "RuntimeConfig_limits" CHECK (
        "maxSamplingRounds" >= 1
        AND "maxToolCalls" >= 0
        AND "runDeadlineMs" >= 1
        AND "historyCandidateHardLimit" BETWEEN 50 AND 1000
    )
);

INSERT INTO "RuntimeConfig" (
    "id", "maxSamplingRounds", "maxToolCalls", "runDeadlineMs", "historyCandidateHardLimit", "debugCaptureModelIo", "updatedAt"
) VALUES (1, 10, 8, 600000, 1000, false, CURRENT_TIMESTAMP);
