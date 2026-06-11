-- Per-user, per-day rollup of session activity (worked time, idle time, session count).
-- Recalculated and upserted for every UTC calendar day that gains new events during a sync.

-- CreateTable
CREATE TABLE "WorkDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "workedMs" INTEGER NOT NULL DEFAULT 0,
    "idleMs" INTEGER NOT NULL DEFAULT 0,
    "sessionCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkDay_pkey" PRIMARY KEY ("id")
);

-- (userId, workDate) is the upsert target — recalculation refreshes in place.
CREATE UNIQUE INDEX "WorkDay_userId_workDate_key" ON "WorkDay"("userId", "workDate");

-- AddForeignKey
ALTER TABLE "WorkDay" ADD CONSTRAINT "WorkDay_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
