-- Onda F (idempotente). Iniciativa 8 (agendamento online): slug público + config de booking.
-- Iniciativa 9 (comissão) ACRESCENTA CommissionRule + OrderItem.commissionCents neste mesmo
-- arquivo — não sobrescreva, compõe (padrão da Onda A/E). [[prod-schema-drift-destravar]]
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "publicSlug" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingLeadMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingHorizonDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bookingSlotStep" INTEGER NOT NULL DEFAULT 15;
-- @unique do Prisma vira índice único; nulos são distintos no Postgres (contas sem slug coexistem).
CREATE UNIQUE INDEX IF NOT EXISTS "User_publicSlug_key" ON "User"("publicSlug");

-- ─────────────────────────────────────────────────────────────────────────────
-- Onda F · Iniciativa 9 (comissão por profissional) — ACRESCENTADO ao arquivo
-- compartilhado com a iniciativa 8 (agendamento online). NÃO sobrescreva; compõe.
-- Tudo IF NOT EXISTS → ordem de aplicação não importa. [[prod-schema-drift-destravar]]
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CommissionRule" (
  "id"             TEXT NOT NULL,
  "accountId"      TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "catalogItemId"  TEXT,
  "percentBps"     INTEGER,
  "fixedCents"     INTEGER,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CommissionRule_professionalId_catalogItemId_key"
  ON "CommissionRule"("professionalId", "catalogItemId");
CREATE INDEX IF NOT EXISTS "CommissionRule_accountId_active_idx"
  ON "CommissionRule"("accountId", "active");
-- FKs idempotentes (ADD CONSTRAINT não tem IF NOT EXISTS → DO-block que ignora duplicata).
DO $$ BEGIN
  ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_professionalId_fkey"
    FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_catalogItemId_fkey"
    FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "professionalId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "commissionCents" INTEGER;
CREATE INDEX IF NOT EXISTS "OrderItem_professionalId_idx" ON "OrderItem"("professionalId");
DO $$ BEGIN
  ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_professionalId_fkey"
    FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
