-- AlterTable
-- Idempotente: em PROD a coluna já pode existir (SQL manual aplicado antes do
-- `migrate deploy` do build). `IF NOT EXISTS` evita o P3018/42701 e deixa a
-- migration ser registrada como aplicada mesmo assim.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "reviewReason" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Appointment_needsReview_idx" ON "Appointment"("needsReview");
