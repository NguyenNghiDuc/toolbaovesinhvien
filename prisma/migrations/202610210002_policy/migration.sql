-- CreateTable
CREATE TABLE "SystemPolicy" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "minPasswordLength" INTEGER NOT NULL DEFAULT 12,
    "maxFailedLogins" INTEGER NOT NULL DEFAULT 10,
    "sessionHours" INTEGER NOT NULL DEFAULT 8,

    CONSTRAINT "SystemPolicy_pkey" PRIMARY KEY ("id")
);

