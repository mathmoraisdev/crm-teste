-- Lembretes de AGENDAMENTO de serviço (Agenda Pro) editáveis por número.
-- Aditivo e idempotente: o build (Vercel + worker) roda `migrate deploy`; o
-- IF NOT EXISTS evita colisão caso a coluna já tenha sido criada manualmente.
ALTER TABLE "WhatsAppNumber" ADD COLUMN IF NOT EXISTS "apptReminderDayBeforeTemplate" TEXT;
ALTER TABLE "WhatsAppNumber" ADD COLUMN IF NOT EXISTS "apptReminderHourBeforeTemplate" TEXT;
