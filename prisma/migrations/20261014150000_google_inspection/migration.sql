CREATE TABLE "GoogleInspection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "googleSub" TEXT NOT NULL,
  "siteUrl" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleInspection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GoogleInspection_userId_idx" ON "GoogleInspection"("userId");
CREATE TABLE "GoogleInspectionBudget" (
  "siteUrl" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "GoogleInspectionBudget_pkey" PRIMARY KEY ("siteUrl", "day"),
  CONSTRAINT "GoogleInspectionBudget_used_check" CHECK ("used" >= 0 AND "used" <= 2000)
);
