-- Confirmação automática de agendamento: campos de revisão no Appointment.
-- Idempotente (PROD nunca fez cutover p/ `migrate deploy` — toda coluna nova
-- precisa deste SQL manual no Supabase, senão qualquer query que a referencie dá 500).
-- Espelha a migration 20260705030000_appointment_needs_review.

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;
CREATE INDEX IF NOT EXISTS "Appointment_needsReview_idx" ON "Appointment"("needsReview");
