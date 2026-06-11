-- Adds clientSessionId to WorkSession so offline-started sessions can be
-- mapped to their server-assigned id on sync. Nullable because sessions
-- started online don't have one. The unique index on (deviceId, clientSessionId)
-- makes lookup-or-create safe under retries: Postgres treats NULLs as distinct,
-- so online sessions (NULL clientSessionId) are unaffected.
ALTER TABLE "WorkSession" ADD COLUMN "clientSessionId" TEXT;

CREATE UNIQUE INDEX "WorkSession_deviceId_clientSessionId_key"
    ON "WorkSession"("deviceId", "clientSessionId");
