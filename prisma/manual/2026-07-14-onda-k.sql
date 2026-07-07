-- Onda K — Origem do agendamento (selo/filtro Online x Manual). Idempotente.
-- Aplicar no Supabase SQL Editor. Coluna com NOT NULL DEFAULT 'MANUAL' preenche
-- os agendamentos existentes sem backfill manual.

-- CREATE TYPE não aceita IF NOT EXISTS; envolve em bloco que ignora se já existe.
DO $$ BEGIN
  CREATE TYPE "AppointmentSource" AS ENUM ('MANUAL', 'ONLINE', 'IA');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "source" "AppointmentSource" NOT NULL DEFAULT 'MANUAL';
