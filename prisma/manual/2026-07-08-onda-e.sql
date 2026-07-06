-- Onda E (idempotente). Iniciativa 7 (IA tool-calling): flag + biblioteca de mídia.
-- Iniciativa 10 (automação) ACRESCENTA Lead.lastEngagedAt neste mesmo arquivo — não sobrescreva, compõe.
-- Regra de ouro da Onda: em PROD só o dono aplica ESTE arquivo idempotente no Supabase
-- SQL Editor; nunca rode SQL manual redundante com uma migration versionada.

-- Iniciativa 7 · Fase 2 — flag por número (default false = fluxo de hoje byte-idêntico).
ALTER TABLE "WhatsAppNumber" ADD COLUMN IF NOT EXISTS "aiToolCallingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Iniciativa 7 · Fase 5 — biblioteca de mídia da conta (a IA envia via enviar_midia).
CREATE TABLE IF NOT EXISTS "MediaAsset" (
  "id"        TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "mediaPath" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "mediaMime" TEXT NOT NULL,
  "fileName"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MediaAsset_accountId_idx" ON "MediaAsset"("accountId");
DO $$ BEGIN
  ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
