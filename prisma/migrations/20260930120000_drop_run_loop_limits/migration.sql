-- 一次问答不再限制模型轮数与工具调用次数，带多少历史只按模型的单次输入上限决定（Issue #218）：删掉三列。
-- PostgreSQL 删列时会连带删掉引用它的整条 CHECK 约束 RuntimeConfig_limits，这里重建，只保留时限的下限。
-- 其余列（时限、调试开关、Serper Key）的值原样保留。
ALTER TABLE "RuntimeConfig"
    DROP COLUMN "maxSamplingRounds",
    DROP COLUMN "maxToolCalls",
    DROP COLUMN "historyCandidateHardLimit";

ALTER TABLE "RuntimeConfig" ADD CONSTRAINT "RuntimeConfig_limits" CHECK ("runDeadlineMs" >= 1);
