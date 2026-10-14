CREATE TABLE "GoogleDataConnection" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "credentials" TEXT,
  "googleSub" TEXT,
  "email" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "needsAuth" BOOLEAN NOT NULL DEFAULT false,
  "configHash" TEXT NOT NULL,
  "authState" TEXT,
  "authExpiresAt" TIMESTAMP(3),
  "pending" TEXT,
  "gscSite" TEXT,
  "ga4Property" TEXT,
  "ga4Stream" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleDataConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleDataConnection_authState_key" ON "GoogleDataConnection"("authState");
