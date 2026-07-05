-- Agendamentos de serviço (Appointment) + enum AppointmentStatus.
-- Aplicar em PROD manualmente (Supabase SQL Editor). Idempotente e ADITIVO.
-- Espelha a migration 20260705013232_appointments. Ver [[prod-schema-drift-destravar]]:
-- o cutover p/ `migrate deploy` não concluiu → tabela/coluna nova exige este SQL
-- manual senão dá 500 em runtime.

DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('AGENDADO','CONFIRMADO','REALIZADO','FALTOU','CANCELADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

CREATE INDEX IF NOT EXISTS "Appointment_leadId_scheduledAt_idx" ON "Appointment"("leadId", "scheduledAt");
CREATE INDEX IF NOT EXISTS "Appointment_seriesId_idx" ON "Appointment"("seriesId");
CREATE INDEX IF NOT EXISTS "Appointment_status_scheduledAt_idx" ON "Appointment"("status", "scheduledAt");

DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Validar: select to_regclass('public."Appointment"');
-- Conferir enum: select enum_range(NULL::"AppointmentStatus");
