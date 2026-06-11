-- Tracks each sync batch submitted by the desktop client. A GUID batchId is
-- generated per submission attempt and resent on retry, so a replayed request
-- is recognized as a no-op rather than reprocessed.

-- CreateTable
CREATE TABLE "SyncBatch" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- (deviceId, batchId) is the whole-batch idempotency key.
CREATE UNIQUE INDEX "SyncBatch_deviceId_batchId_key" ON "SyncBatch"("deviceId", "batchId");

-- AddForeignKey
ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
