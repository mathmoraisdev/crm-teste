-- Onda H (idempotente) — iniciativa 13 (Fiscal NFC-e via emissor terceiro).
-- BYOK cifrado do emissor + perfil fiscal da conta + status fiscal por comanda.
-- Aplicar no Supabase SQL Editor pelo dono ANTES do deploy de código.
-- Enums novos usam guarda por exception (CREATE TYPE não tem IF NOT EXISTS).
-- Reaplicável. NÃO duplicar com migration versionada. [[prod-schema-drift-destravar]]

-- ── enums novos (guarda idempotente) ──────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "FiscalProvider" AS ENUM ('FOCUS_NFE','PLUGNOTAS','TECNOSPEED');
  EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "FiscalEnv" AS ENUM ('HOMOLOGACAO','PRODUCAO');
  EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "FiscalStatus" AS ENUM ('PENDENTE','PROCESSANDO','EMITIDA','ERRO','CANCELADA');
  EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 13.1: credencial BYOK do emissor + perfil fiscal da conta (User, dono) ────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalProvider" "FiscalProvider";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalKeyEnc" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalKeyLast4" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalKeyVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalEnv" "FiscalEnv" NOT NULL DEFAULT 'HOMOLOGACAO';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalSerie" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalCnpj" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalDefaultNcm" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fiscalDefaultCfop" TEXT;

-- ── 13.2: status fiscal por comanda (Order) ───────────────────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalStatus" "FiscalStatus";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalDocId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalKey" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalDanfeUrl" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalError" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalRequestedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalIssuedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fiscalAttempts" INTEGER NOT NULL DEFAULT 0;
-- o worker varre pendentes/processando por conta
CREATE INDEX IF NOT EXISTS "Order_accountId_fiscalStatus_idx" ON "Order"("accountId","fiscalStatus");
