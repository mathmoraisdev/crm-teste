-- CreateEnum / CreateTable — versão IDEMPOTENTE.
-- Motivo: o build roda `prisma migrate deploy`, e em PROD (Supabase) os objetos
-- podem já existir por SQL manual (o cutover p/ migrate deploy nunca concluiu →
-- ver prisma/manual/). Um DDL não-idempotente aqui faria `CREATE TYPE`/`CREATE
-- TABLE` estourar "already exists" → migration FAILED → P3009 aborta o deploy.
-- Com IF NOT EXISTS / DO$$ EXCEPTION o deploy passa exista ou não o objeto.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('AGENDADO', 'CONFIRMADO', 'REALIZADO', 'FALTOU', 'CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "serviceName" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'AGENDADO',
    "note" TEXT,
    "seriesId" TEXT,
    "orderId" TEXT,
    "remindedDayBeforeAt" TIMESTAMP(3),
    "remindedHourBeforeAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_leadId_scheduledAt_idx" ON "Appointment"("leadId", "scheduledAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_seriesId_idx" ON "Appointment"("seriesId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_status_scheduledAt_idx" ON "Appointment"("status", "scheduledAt");

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
