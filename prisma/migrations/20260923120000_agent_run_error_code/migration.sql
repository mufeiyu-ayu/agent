-- Run 的失败类别，取值由 contracts 的 AGENT_RUN_ERROR_CODES 约束；只加列，不回填历史 Run，不加索引。
ALTER TABLE "AgentRun" ADD COLUMN "errorCode" TEXT;
