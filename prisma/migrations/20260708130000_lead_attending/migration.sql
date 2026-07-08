-- Trava de atendimento por conversa (anti-colisão event-driven).
-- Idempotente: PROD roda `migrate deploy` no boot e não pode colidir com estado prévio.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "attendingUserId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "attendingAt" TIMESTAMP(3);

-- Índice do FK (Postgres não indexa FK sozinho).
CREATE INDEX IF NOT EXISTS "Lead_attendingUserId_idx" ON "Lead"("attendingUserId");

-- FK (idempotência via checagem de constraint duplicada).
DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_attendingUserId_fkey"
    FOREIGN KEY ("attendingUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
