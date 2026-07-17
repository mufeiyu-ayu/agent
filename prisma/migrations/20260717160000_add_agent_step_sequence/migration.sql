BEGIN;

-- AddColumn
ALTER TABLE "AgentStep" ADD COLUMN "sequence" INTEGER;

-- Backfill each existing Run independently using a stable order.
WITH ranked_steps AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "runId"
            ORDER BY "createdAt", "id"
        )::INTEGER AS "sequence"
    FROM "AgentStep"
)
UPDATE "AgentStep" AS step
SET "sequence" = ranked_steps."sequence"
FROM ranked_steps
WHERE step."id" = ranked_steps."id";

-- MakeColumnRequired
ALTER TABLE "AgentStep" ALTER COLUMN "sequence" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_sequence_key" ON "AgentStep"("runId", "sequence");

COMMIT;
