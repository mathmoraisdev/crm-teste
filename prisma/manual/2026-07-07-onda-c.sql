-- Onda C — Agenda Pro (profissional/recurso + duração + expediente + conflito +
-- calendário + walk-in). Idempotente. Aplicar no Supabase SQL Editor (env do DB é
-- Sensitive, não alcança daqui). Ver [[prod-schema-drift-destravar]]: NÃO duplicar
-- com migration versionada; mudança de schema da Onda C entra por AQUI (catch-up
-- manual sem migration). Só ESTA iniciativa toca a Onda C — ACRESCENTE, não sobrescreva.

-- ── Fase 1: Profissional/recurso ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Professional" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Professional_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Professional_accountId_active_idx" ON "Professional"("accountId", "active");
DO $$ BEGIN ALTER TABLE "Professional" ADD CONSTRAINT "Professional_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Professional" ADD CONSTRAINT "Professional_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "professionalId" TEXT;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Appointment_professionalId_scheduledAt_idx" ON "Appointment"("professionalId", "scheduledAt");

-- ── Fase 2: Duração por serviço + snapshot ───────────────────────────────────
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;

-- ── Fase 3: Horário de funcionamento ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WorkingHours" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "professionalId" TEXT,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "breakStart" INTEGER,
    "breakEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkingHours_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkingHours_accountId_professionalId_weekday_idx" ON "WorkingHours"("accountId", "professionalId", "weekday");
DO $$ BEGIN ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "WorkingHours" ADD CONSTRAINT "WorkingHours_professionalId_fkey" FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Fase 6: Walk-in (agendamento sem lead) ───────────────────────────────────
-- leadId vira NULLABLE (walk-in não tem lead); accountId escopa o walk-in.
ALTER TABLE "Appointment" ALTER COLUMN "leadId" DROP NOT NULL;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
DO $$ BEGIN ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Appointment_accountId_scheduledAt_idx" ON "Appointment"("accountId", "scheduledAt");

-- Validar:
--   select to_regclass('public."Professional"'), to_regclass('public."WorkingHours"');
--   select column_name from information_schema.columns where table_name='Appointment' and column_name in ('professionalId','durationMinutes','accountId','customerName','customerPhone');
--   select is_nullable from information_schema.columns where table_name='Appointment' and column_name='leadId'; -- YES
