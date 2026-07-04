-- CreateTable
CREATE TABLE "AccountBranding" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "presetId" TEXT,
    "brandScale" JSONB,
    "logoUrl" TEXT,
    "appName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountBranding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountBranding_accountId_key" ON "AccountBranding"("accountId");

-- AddForeignKey
ALTER TABLE "AccountBranding" ADD CONSTRAINT "AccountBranding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
